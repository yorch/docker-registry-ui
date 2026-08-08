import {
  getFromCache,
  setCache,
  invalidateRepository,
  invalidateRegistry,
  MUTABLE_TTL_MS,
  MAX_CACHE_ENTRIES,
} from '../src/scripts/cache-request.js';
import assert from 'assert';

const REGISTRY = 'https://registry.example.com';
const OTHER_REGISTRY = 'https://other.example.com';
const DIGEST = 'sha256:' + 'a1'.repeat(32);
const tagsList = (registry, name) => `${registry}/v2/${name}/tags/list`;
const tagManifest = (registry, name, tag) => `${registry}/v2/${name}/manifests/${tag}`;
const digestManifest = (registry, name) => `${registry}/v2/${name}/manifests/${DIGEST}`;

const body = (text) => ({ responseText: text, dockerContentdigest: DIGEST });

describe('cache-request', () => {
  beforeEach(() => sessionStorage.clear());

  describe('what gets cached', () => {
    it('should cache a digest-addressed manifest', () => {
      setCache('GET', digestManifest(REGISTRY, 'nginx'), body('immutable'));
      assert.equal(getFromCache('GET', digestManifest(REGISTRY, 'nginx')).responseText, 'immutable');
    });

    it('should cache a tags list', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'));
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')).responseText, 'tags');
    });

    it('should cache a tag-addressed manifest', () => {
      setCache('GET', tagManifest(REGISTRY, 'nginx', 'latest'), body('manifest'));
      assert.equal(getFromCache('GET', tagManifest(REGISTRY, 'nginx', 'latest')).responseText, 'manifest');
    });

    it('should not cache the catalog', () => {
      setCache('GET', `${REGISTRY}/v2/_catalog?n=1000`, body('catalog'));
      assert.equal(getFromCache('GET', `${REGISTRY}/v2/_catalog?n=1000`), undefined);
    });

    it('should not cache anything but GET', () => {
      setCache('DELETE', digestManifest(REGISTRY, 'nginx'), body('nope'));
      assert.equal(getFromCache('DELETE', digestManifest(REGISTRY, 'nginx')), undefined);
    });
  });

  // Digest-addressed URLs are content-addressed, so the same digest is the same
  // bytes anywhere. Mutable URLs are not: two registries serve different tags
  // from the same path.
  describe('key scoping', () => {
    it('should share digest-addressed entries across registries', () => {
      setCache('GET', digestManifest(REGISTRY, 'nginx'), body('shared'));
      assert.equal(getFromCache('GET', digestManifest(OTHER_REGISTRY, 'nginx')).responseText, 'shared');
    });

    it('should keep tags lists separate per registry', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('first'));
      setCache('GET', tagsList(OTHER_REGISTRY, 'nginx'), body('second'));
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')).responseText, 'first');
      assert.equal(getFromCache('GET', tagsList(OTHER_REGISTRY, 'nginx')).responseText, 'second');
    });

    it('should keep tags lists separate per repository', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('nginx-tags'));
      setCache('GET', tagsList(REGISTRY, 'redis'), body('redis-tags'));
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'redis')).responseText, 'redis-tags');
    });

    it('should keep negotiated representations separate', () => {
      const url = tagManifest(REGISTRY, 'nginx', 'latest');
      setCache('GET', url, body('docker'), Date.now(), 'accept=docker');
      setCache('GET', url, body('oci'), Date.now(), 'accept=oci');
      assert.equal(getFromCache('GET', url, Date.now(), 'accept=docker').responseText, 'docker');
      assert.equal(getFromCache('GET', url, Date.now(), 'accept=oci').responseText, 'oci');
    });
  });

  describe('expiry', () => {
    it('should expire a tags list once the ttl has passed', () => {
      const now = 1_000_000;
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'), now);
      assert.ok(getFromCache('GET', tagsList(REGISTRY, 'nginx'), now + MUTABLE_TTL_MS - 1));
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx'), now + MUTABLE_TTL_MS + 1), undefined);
    });

    it('should never expire a digest-addressed manifest', () => {
      const now = 1_000_000;
      setCache('GET', digestManifest(REGISTRY, 'nginx'), body('immutable'), now);
      const muchLater = now + MUTABLE_TTL_MS * 10_000;
      assert.equal(getFromCache('GET', digestManifest(REGISTRY, 'nginx'), muchLater).responseText, 'immutable');
    });

    it('should drop the stored entry when it is read after expiry', () => {
      const now = 1_000_000;
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'), now);
      const before = sessionStorage.length;
      getFromCache('GET', tagsList(REGISTRY, 'nginx'), now + MUTABLE_TTL_MS + 1);
      assert.ok(sessionStorage.length < before, 'expired entry should be removed from storage');
    });
  });

  describe('content digest', () => {
    it('should round-trip the docker content digest', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'));
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')).dockerContentdigest, DIGEST);
    });
  });

  // Deleting an image makes that repository's tag list wrong immediately. The
  // list is refetched a second later, so a surviving cache entry would show the
  // deleted tag and look like a failed delete.
  describe('invalidateRepository', () => {
    it('should drop the tags list for that repository', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'));
      invalidateRepository(REGISTRY, 'nginx');
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')), undefined);
    });

    it('should drop tag-addressed manifests for that repository', () => {
      setCache('GET', tagManifest(REGISTRY, 'nginx', 'latest'), body('manifest'));
      invalidateRepository(REGISTRY, 'nginx');
      assert.equal(getFromCache('GET', tagManifest(REGISTRY, 'nginx', 'latest')), undefined);
    });

    it('should leave other repositories alone', () => {
      setCache('GET', tagsList(REGISTRY, 'redis'), body('redis-tags'));
      invalidateRepository(REGISTRY, 'nginx');
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'redis')).responseText, 'redis-tags');
    });

    it('should leave a repository whose name merely shares a prefix alone', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx-extra'), body('other-tags'));
      invalidateRepository(REGISTRY, 'nginx');
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx-extra')).responseText, 'other-tags');
    });
  });

  describe('invalidateRegistry', () => {
    it('should drop mutable entries for one registry only', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('first'));
      setCache('GET', tagsList(OTHER_REGISTRY, 'nginx'), body('second'));
      invalidateRegistry(REGISTRY);
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')), undefined);
      assert.equal(getFromCache('GET', tagsList(OTHER_REGISTRY, 'nginx')).responseText, 'second');
    });
  });

  describe('resilience', () => {
    it('should report a miss for a corrupted entry rather than throwing', () => {
      setCache('GET', tagsList(REGISTRY, 'nginx'), body('tags'));
      const key = Object.keys(sessionStorage).find((k) => k.includes('tags/list'));
      sessionStorage.setItem(key, 'not json');
      assert.equal(getFromCache('GET', tagsList(REGISTRY, 'nginx')), undefined);
    });

    it('should evict least-recently-used entries when the cache reaches its entry budget', () => {
      for (let i = 0; i <= MAX_CACHE_ENTRIES; i++) {
        const digest = `sha256:${i.toString(16).padStart(64, '0')}`;
        setCache('GET', `${REGISTRY}/v2/nginx/manifests/${digest}`, body(String(i)), i + 1);
      }
      assert.ok(sessionStorage.length <= MAX_CACHE_ENTRIES);
      assert.equal(getFromCache('GET', `${REGISTRY}/v2/nginx/manifests/${'sha256:' + '0'.repeat(64)}`), undefined);
    });
  });
});
