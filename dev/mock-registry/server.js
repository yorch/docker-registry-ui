/*
 * A stand-in for a Docker registry, covering the handful of endpoints this UI
 * actually calls:
 *
 *   GET    /v2/_catalog?n=<limit>
 *   GET    /v2/<name>/tags/list
 *   GET    /v2/<name>/manifests/<tag|digest>
 *   GET    /v2/<name>/blobs/<digest>
 *   DELETE /v2/<name>/manifests/<digest>
 *
 * Digests are real: every manifest is hashed with sha256 over the exact bytes
 * served, so content addressing, the Docker-Content-Digest header, caching and
 * delete-by-digest all behave as they do against a real registry rather than
 * agreeing with themselves by accident.
 *
 * No dependencies and no framework, so it can be started from the dev server,
 * a test, or a script without dragging anything along.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  fixtures as defaultFixtures,
  configBlobFor,
  DOCKER_MANIFEST,
  OCI_MANIFEST,
  OCI_INDEX,
  CONFIG_MEDIA_TYPE,
  LAYER_MEDIA_TYPE,
} from './fixtures.js';

const sha256 = (text) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every blob is addressed by the hash of what it contains, so a repository's
// config blob and layers are stable and distinct without bookkeeping.
const blobDigest = (name, label) => sha256(`${name}/${label}`);

const buildManifest = (fixture, platform) => {
  const suffix = platform ? `-${platform.architecture}${platform.variant || ''}` : '';
  const config = configBlobFor(platform ? { ...fixture, architecture: platform.architecture } : fixture);
  const configText = JSON.stringify(config, null, 2);
  const manifest = {
    schemaVersion: 2,
    mediaType: fixture.index ? OCI_MANIFEST : DOCKER_MANIFEST,
    config: {
      mediaType: CONFIG_MEDIA_TYPE,
      size: configText.length,
      digest: blobDigest(fixture.name, `config${suffix}`),
    },
    layers: (fixture.layerSizes || []).map((size, i) => ({
      mediaType: LAYER_MEDIA_TYPE,
      size,
      digest: blobDigest(fixture.name, `layer${suffix}-${i}`),
    })),
  };
  return { manifest, configText };
};

// Turns the declarative fixtures into the documents the endpoints serve, and
// keeps them in a per-instance store so a DELETE in one instance cannot leak
// into the next.
const buildStore = (fixtures) => {
  const repositories = new Map();

  fixtures.forEach((fixture) => {
    const manifests = new Map(); // digest -> { body, mediaType }
    const blobs = new Map(); // digest -> body
    let rootDigest;

    if (fixture.index) {
      // Each platform gets a real child manifest, then the index references them.
      const children = fixture.index.map((platform) => {
        const { manifest, configText } = buildManifest(fixture, platform);
        const body = JSON.stringify(manifest, null, 2);
        const digest = sha256(body);
        manifests.set(digest, { body, mediaType: OCI_MANIFEST });
        blobs.set(manifest.config.digest, configText);
        return { mediaType: OCI_MANIFEST, size: body.length, digest, platform };
      });
      const indexBody = JSON.stringify({ schemaVersion: 2, mediaType: OCI_INDEX, manifests: children }, null, 2);
      rootDigest = sha256(indexBody);
      manifests.set(rootDigest, { body: indexBody, mediaType: OCI_INDEX });
    } else {
      const { manifest, configText } = buildManifest(fixture);
      const body = JSON.stringify(manifest, null, 2);
      rootDigest = sha256(body);
      manifests.set(rootDigest, { body, mediaType: DOCKER_MANIFEST });
      blobs.set(manifest.config.digest, configText);
    }

    // Every tag of a fixture points at the same manifest, which is also what
    // happens on a real registry when one image is tagged several times -- and
    // it is why deleting one tag removes its siblings.
    const tags = new Map(fixture.tags.map((tag) => [tag, rootDigest]));
    repositories.set(fixture.name, { fixture, tags, manifests, blobs });
  });

  return repositories;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'HEAD, GET, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Authorization, Accept, Cache-Control',
  // Without this the browser hides the header and the UI silently falls back to
  // hashing the response body instead of reading the registry's digest.
  'Access-Control-Expose-Headers': 'Docker-Content-Digest',
  'Access-Control-Max-Age': '1728000',
};

const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers });
  res.end(text);
};

const sendError = (res, status, code, message) => send(res, status, { errors: [{ code, message, detail: {} }] });

const notFound = (res) => sendError(res, 404, 'MANIFEST_UNKNOWN', 'manifest unknown');

// A real registry refuses a manifest whose media type the client did not ask
// for, and reports it as MANIFEST_UNKNOWN -- a 404 that reads like a missing
// image but is really failed content negotiation.
const accepts = (acceptHeader, mediaType) => {
  if (!acceptHeader) {
    return false;
  }
  return acceptHeader
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .some((type) => type === mediaType || type === '*/*');
};

// Not 5000, the usual registry port: macOS binds it to AirPlay Receiver by
// default, so a stock Mac fails to start with EADDRINUSE before anything works.
export const DEFAULT_MOCK_PORT = 5555;

export const createMockRegistry = async ({
  port = DEFAULT_MOCK_PORT,
  fixtures = defaultFixtures,
  latency = 0,
} = {}) => {
  const repositories = buildStore(fixtures);
  // Lets a test assert how many times something was asked for, which is how you
  // catch a component that refetches on every render rather than once.
  const requests = new Map();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    requests.set(path, (requests.get(path) || 0) + 1);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (path === '/v2/' || path === '/v2') {
      return send(res, 200, {});
    }

    const catalog = path === '/v2/_catalog';
    const tagsList = /^\/v2\/(.+)\/tags\/list$/.exec(path);
    const manifest = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(path);
    const blob = /^\/v2\/(.+)\/blobs\/(.+)$/.exec(path);

    const repository = repositories.get((tagsList || manifest || blob || [])[1]);
    const delayMs = Math.max(latency, repository?.fixture.delayMs || 0);
    if (delayMs) {
      await sleep(delayMs);
    }

    if (catalog) {
      const limit = Number(url.searchParams.get('n')) || 1000;
      return send(res, 200, { repositories: [...repositories.keys()].slice(0, limit) });
    }

    if (!repository) {
      return sendError(res, 404, 'NAME_UNKNOWN', 'repository name not known to registry');
    }

    if (tagsList) {
      const tags = [...repository.tags.keys()];
      // A real registry reports a repository with no tags as null, not [].
      return send(res, 200, { name: tagsList[1], tags: tags.length ? tags : null });
    }

    if (manifest) {
      const reference = manifest[2];
      const digest = repository.tags.get(reference) || reference;

      if (req.method === 'DELETE') {
        if (!repository.manifests.has(digest)) {
          return notFound(res);
        }
        repository.manifests.delete(digest);
        [...repository.tags.entries()].forEach(([tag, tagDigest]) => {
          if (tagDigest === digest) {
            repository.tags.delete(tag);
          }
        });
        return send(res, 202, '');
      }

      if (repository.fixture.manifestStatus) {
        return notFound(res);
      }
      const stored = repository.manifests.get(digest);
      if (!stored) {
        return notFound(res);
      }
      if (!accepts(req.headers.accept, stored.mediaType)) {
        return sendError(
          res,
          404,
          'MANIFEST_UNKNOWN',
          `OCI manifest found, but accept header does not support ${stored.mediaType}`,
        );
      }
      const headers = { 'Content-Type': stored.mediaType };
      if (!repository.fixture.omitDigestHeader) {
        headers['Docker-Content-Digest'] = digest;
      }
      return send(res, 200, stored.body, headers);
    }

    if (blob) {
      const stored = repository.blobs.get(blob[2]);
      return stored ? send(res, 200, stored) : sendError(res, 404, 'BLOB_UNKNOWN', 'blob unknown to registry');
    }

    return sendError(res, 404, 'UNSUPPORTED', 'unsupported endpoint');
  });

  // listen() reports failure by emitting 'error', so a promise that only
  // resolves from the listening callback never settles when the port is taken:
  // the caller waits forever and the failure escapes as an uncaught exception.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();

  return {
    url: `http://localhost:${address.port}`,
    port: address.port,
    requestCount: (path) => requests.get(path) || 0,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
