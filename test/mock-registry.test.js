import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { createMockRegistry } from '../dev/mock-registry/server.js';

const DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
// What the UI actually sends.
const UI_ACCEPT = `${DOCKER_MANIFEST}, ${OCI_MANIFEST}, ${OCI_INDEX}`;

describe('mock registry', () => {
  let registry;
  const get = (path, headers) => fetch(`${registry.url}${path}`, { headers });
  const json = async (path, headers) => (await get(path, headers)).json();

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
  });
  afterEach(async () => {
    await registry.close();
  });

  describe('catalog', () => {
    it('should list the fixture repositories', async () => {
      const body = await json('/v2/_catalog?n=1000');
      assert.ok(Array.isArray(body.repositories));
      assert.ok(body.repositories.includes('nginx'), 'a plain repository should be listed');
    });

    it('should respect the n limit', async () => {
      const body = await json('/v2/_catalog?n=2');
      assert.equal(body.repositories.length, 2);
    });

    it('should paginate after last and advertise the next page', async () => {
      const first = await get('/v2/_catalog?n=2');
      assert.match(first.headers.get('Link'), /rel="next"/);
      const firstBody = await first.json();
      const second = await json(`/v2/_catalog?n=2&last=${encodeURIComponent(firstBody.repositories.at(-1))}`);
      assert.equal(second.repositories.length, 2);
      assert.ok(!second.repositories.some((name) => firstBody.repositories.includes(name)));
    });
  });

  describe('tags', () => {
    it('should list tags for a repository', async () => {
      const body = await json('/v2/nginx/tags/list');
      assert.equal(body.name, 'nginx');
      assert.ok(body.tags.length > 0);
    });

    it('should list tags for a nested repository name', async () => {
      const body = await json('/v2/team/service-a/tags/list');
      assert.equal(body.name, 'team/service-a');
      assert.ok(body.tags.length > 0);
    });

    it('should 404 for a repository that does not exist', async () => {
      assert.equal((await get('/v2/nope/tags/list')).status, 404);
    });

    it('should report a tagless repository with a null tags field', async () => {
      const body = await json('/v2/empty/tags/list');
      assert.equal(body.tags, null);
    });
  });

  describe('manifests', () => {
    it('should serve a manifest by tag with a matching content digest', async () => {
      const response = await get('/v2/nginx/manifests/latest', { Accept: UI_ACCEPT });
      assert.equal(response.status, 200);
      const digest = response.headers.get('Docker-Content-Digest');
      assert.match(digest, /^sha256:[a-f0-9]{64}$/);
      // Content addressed for real: the digest must be the hash of the exact
      // bytes served, not merely a key that happens to resolve to them.
      const body = await response.text();
      assert.equal(digest, `sha256:${createHash('sha256').update(body).digest('hex')}`);
      const byDigest = await get(`/v2/nginx/manifests/${digest}`, { Accept: UI_ACCEPT });
      assert.equal(await byDigest.text(), body);
    });

    // The real registry answers MANIFEST_UNKNOWN when the Accept header does not
    // cover the stored media type -- a 404 that looks like a missing image but
    // is really failed content negotiation.
    it('should 404 when the accept header does not cover the media type', async () => {
      const response = await get('/v2/oci-index/manifests/latest', { Accept: DOCKER_MANIFEST });
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.errors[0].code, 'MANIFEST_UNKNOWN');
    });

    it('should serve an oci index with platforms', async () => {
      const body = await json('/v2/oci-index/manifests/latest', { Accept: UI_ACCEPT });
      assert.equal(body.mediaType, OCI_INDEX);
      assert.ok(body.manifests.length > 1, 'an index should reference several platforms');
      body.manifests.forEach((manifest) => {
        assert.equal(manifest.mediaType, OCI_MANIFEST);
        assert.ok(manifest.platform.architecture);
      });
    });

    it('should serve the child manifests an index references', async () => {
      const index = await json('/v2/oci-index/manifests/latest', { Accept: UI_ACCEPT });
      const child = await get(`/v2/oci-index/manifests/${index.manifests[0].digest}`, { Accept: UI_ACCEPT });
      assert.equal(child.status, 200);
    });

    // Drives the `—` unavailable state in the tag table.
    it('should 404 manifests for the deliberately broken repository', async () => {
      const tags = await json('/v2/broken-manifest/tags/list');
      assert.ok(tags.tags.length > 0, 'the repository still lists tags');
      const response = await get(`/v2/broken-manifest/manifests/${tags.tags[0]}`, { Accept: UI_ACCEPT });
      assert.equal(response.status, 404);
    });

    // Forces Http.getContentDigest down its SHA-256 fallback.
    it('should omit the content digest header for the no-digest-header repository', async () => {
      const response = await get('/v2/no-digest-header/manifests/latest', { Accept: UI_ACCEPT });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Docker-Content-Digest'), null);
    });
  });

  describe('blobs', () => {
    it('should serve the config blob a manifest points at', async () => {
      const manifest = await json('/v2/nginx/manifests/latest', { Accept: UI_ACCEPT });
      const blob = await json(`/v2/nginx/blobs/${manifest.config.digest}`);
      assert.ok(blob.created, 'the config blob carries the creation date');
      assert.ok(blob.architecture);
      assert.ok(Array.isArray(blob.history));
    });
  });

  describe('delete', () => {
    it('should remove every tag sharing the deleted digest', async () => {
      const response = await get('/v2/nginx/manifests/latest', { Accept: UI_ACCEPT });
      const digest = response.headers.get('Docker-Content-Digest');
      const deleted = await fetch(`${registry.url}/v2/nginx/manifests/${digest}`, { method: 'DELETE' });
      assert.equal(deleted.status, 202);
      const tags = await json('/v2/nginx/tags/list');
      assert.ok(!(tags.tags || []).includes('latest'), 'the deleted tag should be gone');
    });

    it('should 404 a manifest that was deleted', async () => {
      const response = await get('/v2/nginx/manifests/latest', { Accept: UI_ACCEPT });
      const digest = response.headers.get('Docker-Content-Digest');
      await fetch(`${registry.url}/v2/nginx/manifests/${digest}`, { method: 'DELETE' });
      assert.equal((await get('/v2/nginx/manifests/latest', { Accept: UI_ACCEPT })).status, 404);
    });

    it('should refuse to delete by tag, as Distribution does', async () => {
      const deleted = await fetch(`${registry.url}/v2/nginx/manifests/latest`, { method: 'DELETE' });
      assert.equal(deleted.status, 405);
      assert.equal((await deleted.json()).errors[0].code, 'UNSUPPORTED');
      assert.ok((await json('/v2/nginx/tags/list')).tags.includes('latest'), 'nothing may be removed');
    });

    it('should start from clean fixtures for each instance', async () => {
      const tags = await json('/v2/nginx/tags/list');
      assert.ok(tags.tags.includes('latest'), 'a previous delete must not leak into a new instance');
    });
  });

  // The UI runs on a different origin from the registry, so every one of these
  // has to be right or the browser hides the response.
  describe('CORS', () => {
    it('should allow the request origin', async () => {
      const response = await get('/v2/_catalog?n=10', { Origin: 'http://localhost:8000' });
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
    });

    it('should expose the content digest header', async () => {
      const response = await get('/v2/_catalog?n=10');
      assert.match(response.headers.get('Access-Control-Expose-Headers'), /Docker-Content-Digest/i);
    });

    it('should expose the catalog pagination link', async () => {
      const response = await get('/v2/_catalog?n=2');
      assert.match(response.headers.get('Access-Control-Expose-Headers'), /Link/i);
    });

    it('should answer a preflight allowing DELETE', async () => {
      const response = await fetch(`${registry.url}/v2/nginx/manifests/latest`, { method: 'OPTIONS' });
      assert.ok(response.status === 200 || response.status === 204);
      assert.match(response.headers.get('Access-Control-Allow-Methods'), /DELETE/);
    });
  });

  // listen() reports failure by emitting 'error', not by rejecting, so a naive
  // promise wrapper never settles and the failure surfaces as an uncaught
  // exception that takes the dev server down instead of a message the caller
  // can act on. Port 5000 is a real case: macOS AirPlay Receiver holds it.
  describe('startup failure', () => {
    it('should reject when the port is already taken', async () => {
      const other = await createMockRegistry({ port: 0 });
      await assert.rejects(() => createMockRegistry({ port: other.port }), /EADDRINUSE/);
      await other.close();
    });
  });

  describe('scale fixture', () => {
    it('should serve a repository large enough to paginate', async () => {
      const body = await json('/v2/huge/tags/list');
      assert.ok(body.tags.length >= 1000, `expected a big tag list, got ${body.tags.length}`);
    });

    // The pagination boundary that used to render an empty trailing page.
    it('should serve a repository with exactly one page of tags', async () => {
      const body = await json('/v2/exactly-100/tags/list');
      assert.equal(body.tags.length, 100);
    });
  });

  describe('options', () => {
    let custom;
    afterEach(async () => {
      await custom?.close();
    });

    it('should refuse every DELETE when deletes are disabled', async () => {
      custom = await createMockRegistry({ port: 0, allowDelete: false });
      const response = await fetch(`${custom.url}/v2/nginx/manifests/latest`, { headers: { Accept: UI_ACCEPT } });
      const digest = response.headers.get('Docker-Content-Digest');
      const deleted = await fetch(`${custom.url}/v2/nginx/manifests/${digest}`, { method: 'DELETE' });
      assert.equal(deleted.status, 405);
    });

    it('should paginate sorted tags with a Link header when tagPageSize is set', async () => {
      custom = await createMockRegistry({ port: 0, tagPageSize: 2 });
      const first = await fetch(`${custom.url}/v2/nginx/tags/list`);
      const firstBody = await first.json();
      assert.deepEqual(firstBody.tags, ['1.26', '1.27']);
      const link = first.headers.get('Link');
      assert.match(link, /rel="next"/);
      const next = /<([^>]+)>/.exec(link)[1];
      const second = await (await fetch(`${custom.url}${next}`)).json();
      assert.deepEqual(second.tags, ['1.27.3', 'latest']);
    });

    it('should honour a smaller n than the page size', async () => {
      custom = await createMockRegistry({ port: 0, tagPageSize: 3 });
      const body = await (await fetch(`${custom.url}/v2/nginx/tags/list?n=1`)).json();
      assert.deepEqual(body.tags, ['1.26']);
    });
  });
});

describe('mock registry exposure', () => {
  let registry;
  afterEach(async () => {
    await registry?.close();
    delete process.env.MOCK_REGISTRY_HOST;
    delete process.env.MOCK_REGISTRY_ORIGINS;
  });

  const preflight = (origin) =>
    fetch(`${registry.url}/v2/_catalog`, { method: 'OPTIONS', headers: { Origin: origin } });

  it('should bind to loopback by default', async () => {
    registry = await createMockRegistry({ port: 0 });
    assert.equal(registry.host, '127.0.0.1');
  });

  it('should honour the host option and MOCK_REGISTRY_HOST', async () => {
    registry = await createMockRegistry({ port: 0, host: '::1' });
    assert.equal(registry.host, '::1');
    await registry.close();
    process.env.MOCK_REGISTRY_HOST = 'localhost';
    registry = await createMockRegistry({ port: 0 });
    assert.equal(registry.host, 'localhost');
  });

  it('should allow the dev server origin and nothing else by default', async () => {
    registry = await createMockRegistry({ port: 0 });
    const allowed = await preflight('http://localhost:8000');
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
    assert.match(allowed.headers.get('Vary'), /Origin/);
    const other = await preflight('https://evil.example');
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
    const get = await fetch(`${registry.url}/v2/_catalog`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(get.headers.get('Access-Control-Allow-Origin'), null);
  });

  it('should never answer with a wildcard unless asked to', async () => {
    registry = await createMockRegistry({ port: 0 });
    const response = await fetch(`${registry.url}/v2/_catalog`);
    // No Origin header (not a browser page): answered for the first allowed origin.
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost');
  });

  it('should allow the origins given by option or MOCK_REGISTRY_ORIGINS', async () => {
    registry = await createMockRegistry({ port: 0, allowedOrigins: ['http://localhost:9000'] });
    assert.equal(
      (await preflight('http://localhost:9000')).headers.get('Access-Control-Allow-Origin'),
      'http://localhost:9000',
    );
    assert.equal((await preflight('http://localhost:8000')).headers.get('Access-Control-Allow-Origin'), null);
    await registry.close();
    process.env.MOCK_REGISTRY_ORIGINS = 'http://a.test:1, http://b.test:2';
    registry = await createMockRegistry({ port: 0 });
    assert.equal((await preflight('http://b.test:2')).headers.get('Access-Control-Allow-Origin'), 'http://b.test:2');
  });

  it('should allow any origin when the list is *', async () => {
    registry = await createMockRegistry({ port: 0, allowedOrigins: ['*'] });
    assert.equal((await preflight('https://anything.example')).headers.get('Access-Control-Allow-Origin'), '*');
  });
});
