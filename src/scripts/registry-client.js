/*
 * Promise-based access to the parts of the Distribution API used by the
 * operations views. Every wire request goes through the shared pool and Http,
 * so authentication, credential mode, cache policy and concurrency stay
 * consistent with the catalogue and tag list.
 */
import { Http } from './http.js';
import { requestPool } from './request-pool.js';
import { filterWrongManifests, supportListManifest } from './docker-image.js';

export const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

export const parseNextLink = (header, baseUrl) => {
  if (!header) return undefined;
  const part = header.split(',').find((entry) => /;\s*rel\s*=\s*["']?next["']?/i.test(entry));
  const match = part && /<([^>]+)>/.exec(part);
  if (!match) return undefined;
  try {
    return new URL(match[1], baseUrl).toString();
  } catch (_error) {
    return undefined;
  }
};

const sumLayers = (layers = []) => layers.reduce((total, layer) => total + (Number(layer.size) || 0), 0);

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
      requestPool.submit((done) => {
        const request = new Http({
          onAuthentication: this.onAuthentication,
          withCredentials: this.isRegistrySecured,
          noCache,
        });
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          done();
          callback(value);
        };
        request.addEventListener('error', function () {
          finish(reject, this.getErrorMessage());
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
      });
    });
  }

  async catalogPage({ url, pageSize = 100 } = {}) {
    const pageUrl = url || `${this.registryUrl}/v2/_catalog?n=${pageSize}`;
    const response = await this.request(pageUrl);
    return {
      repositories: response.json?.repositories || [],
      next: parseNextLink(response.header('Link'), pageUrl),
    };
  }

  async allRepositories({ pageSize = 100, onProgress, isCancelled = () => false } = {}) {
    const repositories = new Set();
    let next;
    do {
      if (isCancelled()) break;
      const page = await this.catalogPage({ url: next, pageSize });
      page.repositories.forEach((name) => repositories.add(name));
      next = page.next;
      onProgress?.({ repositories: [...repositories].sort(), hasMore: Boolean(next) });
    } while (next);
    return [...repositories].sort();
  }

  async tags(repository, { noCache = false } = {}) {
    const response = await this.request(`${this.registryUrl}/v2/${repository}/tags/list`, { noCache });
    return response.json?.tags || [];
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

  async inspectTag(repository, tag, { noCache = false } = {}) {
    const root = await this.manifest(repository, tag, { noCache });
    if (!supportListManifest(root)) {
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
        isIndex: false,
      };
    }

    const descriptors = filterWrongManifests(root);
    const platforms = await Promise.all(
      descriptors.map(async (descriptor) => {
        const manifest = await this.manifest(repository, descriptor.digest);
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
      created: platforms
        .map((platform) => platform.created)
        .filter(Boolean)
        .sort()[0],
      size: sumLayers([...uniqueLayers.values()]),
      layers: [...uniqueLayers.values()],
      platforms,
      isIndex: true,
    };
  }

  deleteManifest(repository, digest) {
    return this.request(`${this.registryUrl}/v2/${repository}/manifests/${digest}`, {
      method: 'DELETE',
      noCache: true,
    });
  }
}
