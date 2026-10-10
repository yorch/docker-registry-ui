/*
 * Promise-based access to the parts of the Distribution API used by the
 * operations views. Every wire request goes through the shared pool and Http,
 * so authentication, credential mode, cache policy and concurrency stay
 * consistent with the catalogue and tag list.
 */

import { Http } from './http.js';
import { requestPool } from './request-pool.js';

export const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

// A registry that never stops advertising a next page must not keep a scan (or
// a delete verification) alive forever.
export const MAX_PAGES = 1000;

// Nested index levels walkIndex follows before failing closed.
export const MAX_INDEX_DEPTH = 8;

/*
 * The Link header comes from the registry, but its target is still only a hint:
 * following an absolute link to another origin would send the registry
 * credentials there. A link is therefore followed only when it stays on the
 * origin of the page that returned it and, when `registryUrl` is given, under
 * that registry's base path. Anything else reads as unparseable, which callers
 * treat as a failure rather than as the end of the list.
 */
export const parseNextLink = (header, baseUrl, registryUrl) => {
  if (!header) return undefined;
  const part = header.split(',').find((entry) => /;\s*rel\s*=\s*["']?next["']?/i.test(entry));
  const match = part && /<([^>]+)>/.exec(part);
  if (!match) return undefined;
  try {
    const target = new URL(match[1], baseUrl);
    if (target.origin !== new URL(baseUrl).origin) return undefined;
    if (registryUrl) {
      const registry = new URL(registryUrl);
      const prefix = registry.pathname.replace(/\/$/, '');
      if (target.origin !== registry.origin) return undefined;
      if (prefix && target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`)) return undefined;
    }
    return target.toString();
  } catch (_error) {
    return undefined;
  }
};

const hasNextRel = (link) => Boolean(link) && /rel\s*=\s*["']?next/i.test(link);

const INDEX_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]);
// Same predicate filterWrongManifests uses to hide attestations from display.
const isAttestation = (descriptor) => descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest';
// Deliberately broader than supportListManifest, which answers "can the UI list
// this as platforms" and says no to an OCI index with a non-OCI child or a
// nested index. Protection must treat any index as an index.
const isIndexManifest = (manifest) => Array.isArray(manifest?.manifests) || INDEX_TYPES.has(manifest?.mediaType);

const sumLayers = (layers = []) => layers.reduce((total, layer) => total + (Number(layer.size) || 0), 0);

/*
 * The newest of a set of timestamps, compared as dates rather than as strings:
 * ISO 8601 only sorts lexicographically when every value shares one precision
 * and offset, which manifests written by different builders do not.
 *
 * Newest rather than oldest is a safety choice. An index's date feeds the
 * retention cutoff, and taking the oldest platform would make a recently
 * re-pushed multi-platform tag read as stale and become a deletion candidate.
 */
export const newestDate = (values) =>
  values
    .filter(Boolean)
    .filter((value) => !Number.isNaN(new Date(value).getTime()))
    .sort((left, right) => new Date(right) - new Date(left))[0];

/*
 * Http.getErrorMessage() returns either a prose string or a `{ code, url }`
 * object that the error page knows how to render. Callers here reject with an
 * Error and display `error.message`, so the object form used to surface as
 * "[object Object]" -- precisely in the mixed-content and bad-URL cases where
 * the message is the only thing telling the user what to change. The code and
 * url are kept on the Error for anything that wants to render them properly.
 */
const CODE_MESSAGES = {
  MIXED_CONTENT:
    'This page is served over HTTPS but the registry URL is HTTP, so the browser blocked the request. Serve the registry over HTTPS.',
  INCORRECT_URL: 'The registry URL is not a valid absolute http(s) URL.',
};

export const toRegistryError = (reason) => {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  const error = new Error(CODE_MESSAGES[reason?.code] || `The registry request failed (${reason?.code || 'unknown'}).`);
  error.code = reason?.code;
  error.url = reason?.url;
  return error;
};

const digestResponse = async (text) => {
  if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) return undefined;
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export class RegistryClient {
  constructor({ registryUrl, onAuthentication, isRegistrySecured = false }) {
    this.registryUrl = registryUrl.replace(/\/$/, '');
    this.onAuthentication = onAuthentication;
    this.isRegistrySecured = isRegistrySecured;
  }

  request(url, { method = 'GET', accept, noCache = false } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      // Only set once the task actually starts. A task dropped from the queue
      // never ran, so it never took a slot and must not release one.
      let release = () => {};
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        release();
        callback(value);
      };
      const task = (done) => {
        release = done;
        const request = new Http({
          onAuthentication: this.onAuthentication,
          withCredentials: this.isRegistrySecured,
          noCache,
        });
        request.addEventListener('error', function () {
          finish(reject, toRegistryError(this.getErrorMessage()));
        });
        request.addEventListener('loadend', function () {
          const response = {
            status: this.status,
            text: this.responseText,
            header: (name) => this.getResponseHeader(name),
          };
          if (this.status >= 200 && this.status < 300) {
            try {
              response.json = this.responseText ? JSON.parse(this.responseText) : undefined;
              finish(resolve, response);
            } catch (error) {
              finish(reject, new Error(`Registry returned invalid JSON for ${url}: ${error.message}`));
            }
          } else {
            let message = this.responseText || `Registry request failed with HTTP ${this.status}`;
            try {
              const parsed = JSON.parse(this.responseText);
              message = parsed.errors?.[0]?.message || message;
            } catch (_error) {}
            const error = new Error(message);
            error.status = this.status;
            error.url = url;
            finish(reject, error);
          }
        });
        request.open(method, url);
        if (accept) request.setRequestHeader('Accept', accept);
        request.send();
      };
      requestPool.submit(task, () => {
        const error = new Error(`The request for ${url} was cancelled before it started.`);
        error.cancelled = true;
        finish(reject, error);
      });
    });
  }

  /*
   * `visited` is the loop guard for catalogue continuation. The `Link` header is
   * supplied by the registry, and a proxy that rewrites it -- or a registry that
   * ignores `last=` -- can advertise a next page that points back at one already
   * read. Without this the paging loops below never terminate. Pass the same Set
   * through every page of one traversal; omit it for a single page.
   */
  async catalogPage({ url, pageSize = 100, visited } = {}) {
    const pageUrl = url || `${this.registryUrl}/v2/_catalog?n=${pageSize}`;
    visited?.add(pageUrl);
    const response = await this.request(pageUrl);
    const link = response.header('Link');
    const next = parseNextLink(link, pageUrl, this.registryUrl);
    if (!next && hasNextRel(link)) {
      throw new Error('The repository catalogue has a next page that could not be followed');
    }
    return {
      repositories: response.json?.repositories || [],
      next: next && visited?.has(next) ? undefined : next,
    };
  }

  async allRepositories({ pageSize = 100, onProgress, isCancelled = () => false, maxPages = MAX_PAGES } = {}) {
    const repositories = new Set();
    const visited = new Set();
    let next;
    let pages = 0;
    do {
      if (isCancelled()) break;
      if (++pages > maxPages) throw new Error(`The repository catalogue has more than ${maxPages} pages`);
      const page = await this.catalogPage({ url: next, pageSize, visited });
      page.repositories.forEach((name) => repositories.add(name));
      next = page.next;
      onProgress?.({ repositories: [...repositories].sort(), hasMore: Boolean(next) });
    } while (next);
    return [...repositories].sort();
  }

  /*
   * Follows `Link: rel="next"` so a registry that paginates tags/list is read
   * in full. A next link that cannot be followed -- unparseable, off the
   * registry's origin or path, or pointing back at a page already read -- throws
   * rather than returning what was read so far: callers such as currentAliases
   * rely on this list being complete, and a partial one is indistinguishable
   * from a repository that simply has fewer tags.
   *
   * Always read past the cache. Http replays a cached response without its Link
   * header, and the catalogue caches this same URL for its tag counts, so a
   * cached first page would look like the whole list.
   */
  async tags(repository, { maxPages = MAX_PAGES } = {}) {
    const tags = [];
    const visited = new Set();
    let url = `${this.registryUrl}/v2/${repository}/tags/list`;
    let pages = 0;
    while (url) {
      if (++pages > maxPages) throw new Error(`The tag list for ${repository} has more than ${maxPages} pages`);
      visited.add(url);
      const response = await this.request(url, { noCache: true });
      tags.push(...(response.json?.tags || []));
      const link = response.header('Link');
      const next = parseNextLink(link, url, this.registryUrl);
      if (!next && hasNextRel(link)) {
        throw new Error(`The tag list for ${repository} has a next page that could not be followed`);
      }
      if (next && visited.has(next)) {
        throw new Error(`The tag list for ${repository} links back to a page already read`);
      }
      url = next;
    }
    return tags;
  }

  async manifest(repository, reference, { noCache = false } = {}) {
    const response = await this.request(`${this.registryUrl}/v2/${repository}/manifests/${reference}`, {
      accept: MANIFEST_ACCEPT,
      noCache,
    });
    const digest =
      response.header('Docker-Content-Digest') ||
      (reference.startsWith('sha256:') ? reference : await digestResponse(response.text));
    return {
      ...response.json,
      digest,
    };
  }

  async blob(repository, digest) {
    return (await this.request(`${this.registryUrl}/v2/${repository}/blobs/${digest}`)).json;
  }

  /*
   * Every digest an index reaches, however deep: its own descriptors (including
   * the attestation descriptors the display hides) and, recursively, those of
   * any nested index. Deleting any of them breaks the index. Returns the digests
   * and the non-index manifests that were read on the way (inspectTag turns
   * those into platforms). A manifest that cannot be read rejects, so a caller
   * never mistakes a partly walked index for a fully walked one.
   *
   * Leaves are only fetched when `fetchLeaves` is set; descending needs just the
   * nested indexes, recognised by their descriptor's media type. Nesting deeper
   * than MAX_INDEX_DEPTH throws rather than returning a partial walk.
   */
  async walkIndex(repository, root, { noCache = false, fetchLeaves = false, visited = new Set(), depth = 0 } = {}) {
    if (depth > MAX_INDEX_DEPTH) {
      throw new Error(`Index ${repository}@${root.digest} is nested more than ${MAX_INDEX_DEPTH} levels deep`);
    }
    const references = new Set();
    visited.add(root.digest);
    // Each child resolves to its own leaves and they are joined afterwards, so
    // the order follows the index and not whichever fetch finished first.
    const perChild = await Promise.all(
      (root.manifests || []).map(async (descriptor) => {
        if (!descriptor.digest) return [];
        references.add(descriptor.digest);
        if (isAttestation(descriptor) || visited.has(descriptor.digest)) return [];
        if (!fetchLeaves && !INDEX_TYPES.has(descriptor.mediaType)) return [];
        visited.add(descriptor.digest);
        const manifest = await this.manifest(repository, descriptor.digest, { noCache });
        if (isIndexManifest(manifest)) {
          const nested = await this.walkIndex(repository, manifest, {
            noCache,
            fetchLeaves,
            visited,
            depth: depth + 1,
          });
          nested.references.forEach((digest) => references.add(digest));
          return nested.leaves;
        }
        return [{ descriptor, manifest }];
      }),
    );
    return { references, leaves: perChild.flat() };
  }

  async inspectTag(repository, tag, { noCache = false } = {}) {
    const root = await this.manifest(repository, tag, { noCache });
    if (!isIndexManifest(root)) {
      const config = root.config?.digest ? await this.blob(repository, root.config.digest) : {};
      const layers = root.layers || [];
      return {
        repository,
        tag,
        digest: root.digest,
        created: config?.created || root.annotations?.['org.opencontainers.image.created'],
        size: sumLayers(layers),
        layers,
        platforms: [
          {
            digest: root.digest,
            os: config?.os || 'unknown',
            architecture: config?.architecture || 'unknown',
            variant: config?.variant,
            created: config?.created || root.annotations?.['org.opencontainers.image.created'],
            size: sumLayers(layers),
            layers,
          },
        ],
        references: [],
        isIndex: false,
      };
    }

    const { references, leaves } = await this.walkIndex(repository, root, { noCache, fetchLeaves: true });
    const platforms = await Promise.all(
      leaves.map(async ({ descriptor, manifest }) => {
        const config = manifest.config?.digest ? await this.blob(repository, manifest.config.digest) : {};
        const layers = manifest.layers || [];
        return {
          digest: descriptor.digest,
          os: descriptor.platform?.os || config?.os || 'unknown',
          architecture: descriptor.platform?.architecture || config?.architecture || 'unknown',
          variant: descriptor.platform?.variant || config?.variant,
          created: config?.created || manifest.annotations?.['org.opencontainers.image.created'],
          size: sumLayers(layers),
          layers,
        };
      }),
    );
    const uniqueLayers = new Map();
    platforms.forEach((platform) =>
      platform.layers.forEach((layer) => {
        if (!uniqueLayers.has(layer.digest)) uniqueLayers.set(layer.digest, layer);
      }),
    );
    return {
      repository,
      tag,
      digest: root.digest,
      created: newestDate(platforms.map((platform) => platform.created)),
      size: sumLayers([...uniqueLayers.values()]),
      layers: [...uniqueLayers.values()],
      platforms,
      // The whole descendant set, attestations and nested indexes included, and
      // not just the platforms shown: retention protects on this.
      references: [...references],
      isIndex: true,
    };
  }

  /*
   * What a retention preview or tag-list delete must re-check, read past the
   * cache: `aliases` (digest -> tags now resolving to it) and `referenced`
   * (digest -> the sorted index tags whose descendants include it).
   *
   * This is the guard between a preview and an irreversible delete:
   * `DELETE /manifests/<digest>` removes *every* tag resolving to that digest
   * and breaks every index referencing it, so a tag or an index created since
   * the preview would be damaged without ever having been shown. A tag whose
   * manifest cannot be read, or whose digest neither the registry nor the
   * browser can establish, makes the whole repository unverifiable -- refuse
   * rather than delete on incomplete evidence. An index referenced only by
   * digest (no tag) cannot be discovered through the tag list; that is a limit
   * of the registry API, not something this can close.
   *
   * One snapshot per repository is both cheaper and more consistent than
   * re-reading between deletes: deleting one digest cannot change which tags
   * resolve to a different one.
   */
  async currentAliases(repository) {
    const tags = await this.tags(repository);
    const settled = await Promise.allSettled(tags.map((tag) => this.manifest(repository, tag, { noCache: true })));
    const aliases = new Map();
    const referenced = new Map();
    const manifests = settled.map((result, index) => {
      if (result.status !== 'fulfilled') {
        throw new Error(`Could not re-read ${repository}:${tags[index]} to verify the preview; nothing was deleted`);
      }
      if (!result.value.digest) {
        throw new Error(
          `Could not establish a content digest for ${repository}:${tags[index]}; nothing was deleted. ` +
            'Expose the Docker-Content-Digest header, or serve the UI over HTTPS so it can hash the manifest itself.',
        );
      }
      return result.value;
    });
    manifests.forEach((manifest, index) => {
      aliases.set(manifest.digest, [...(aliases.get(manifest.digest) || []), tags[index]]);
    });
    await Promise.all(
      manifests.map(async (manifest, index) => {
        if (!isIndexManifest(manifest)) return;
        let walked;
        try {
          // fetchLeaves: every non-attestation child is fetched and classified by
          // its body, as inspectTag does, rather than trusting the descriptor's
          // declared mediaType (a nested index whose descriptor omits or
          // mislabels it would otherwise leave its children unprotected). The
          // extra GET per child per tagged index is the price of failing closed.
          // noCache: digest-addressed cache entries are not hash-verified.
          walked = await this.walkIndex(repository, manifest, { noCache: true, fetchLeaves: true });
        } catch (_error) {
          throw new Error(
            `Could not read the contents of index ${repository}:${tags[index]} to verify the preview; nothing was deleted`,
          );
        }
        walked.references.forEach((digest) => {
          referenced.set(digest, [...(referenced.get(digest) || []), tags[index]]);
        });
      }),
    );
    // Every parent index tag, in a stable order: the walks finish in whatever
    // order the registry answers them.
    referenced.forEach((parents, digest) => referenced.set(digest, [...new Set(parents)].sort()));
    return { aliases, referenced };
  }

  deleteManifest(repository, digest) {
    return this.request(`${this.registryUrl}/v2/${repository}/manifests/${digest}`, {
      method: 'DELETE',
      noCache: true,
    });
  }
}
