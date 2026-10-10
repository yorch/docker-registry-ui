import assert from 'node:assert';
import { createServer } from 'node:http';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import {
  MAX_INDEX_DEPTH,
  newestDate,
  parseNextLink,
  RegistryClient,
  toRegistryError,
} from '../src/scripts/registry-client.js';
import { MAX_CONCURRENT_REQUESTS, requestPool } from '../src/scripts/request-pool.js';
import { createFake, OCI_I, OCI_M } from './support/fake-registry.js';

describe('registry client', () => {
  let registry;

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
  });

  afterEach(async () => {
    await registry.close();
  });

  it('should resolve a relative next catalog link', () => {
    assert.equal(
      parseNextLink('</v2/_catalog?n=2&last=nginx>; rel="next"', 'https://registry.example/v2/_catalog?n=2'),
      'https://registry.example/v2/_catalog?n=2&last=nginx',
    );
  });

  it('should ignore unrelated or malformed links', () => {
    assert.equal(parseNextLink('</previous>; rel="previous"', 'https://registry.example/v2/_catalog'), undefined);
    assert.equal(parseNextLink('not a link', 'https://registry.example/v2/_catalog'), undefined);
  });

  it('should follow all catalog pages without duplicates', async () => {
    const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
    const repositories = await client.allRepositories({ pageSize: 2 });
    assert.ok(repositories.length > 2);
    assert.equal(repositories.length, new Set(repositories).size);
    assert.ok(repositories.includes('oci-index'));
  });

  it('should inspect every platform and deduplicate shared layers', async () => {
    const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
    const details = await client.inspectTag('oci-index', 'latest');
    assert.equal(details.isIndex, true);
    assert.equal(details.platforms.length, 3);
    assert.deepEqual(
      details.platforms.map((platform) => platform.architecture),
      ['amd64', 'arm64', 'ppc64le'],
    );
    assert.equal(
      details.size,
      details.platforms.reduce((total, platform) => total + platform.size, 0),
    );
  });

  it('should derive a safe digest when a proxy hides the digest header', async () => {
    const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
    const details = await client.inspectTag('no-digest-header', 'latest');
    assert.match(details.digest, /^sha256:[a-f0-9]{64}$/);
  });

  it('should stop paging when a continuation link points at a page already read', async () => {
    const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
    const first = await client.catalogPage({ pageSize: 2 });
    assert.ok(first.next, 'the fixture registry should advertise a next page');

    // A registry -- or a proxy rewriting Link -- that points back at a page
    // already read must not be followed, or the paging loops never terminate.
    const visited = new Set([first.next]);
    const replayed = await client.catalogPage({ pageSize: 2, visited });
    assert.deepEqual(replayed.repositories, first.repositories);
    assert.equal(replayed.next, undefined);
  });

  it('should reject a request the pool drops instead of pending forever', async () => {
    const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
    // Fill every slot so the next request is still queued when the drop lands.
    // Nothing awaits these: they are only here to occupy the pool.
    const inFlight = Array.from({ length: MAX_CONCURRENT_REQUESTS }, () => client.tags('nginx').catch(() => {}));
    const queued = client.tags('oci-index');

    // What catalog.display() does on Refresh and on a registry switch.
    requestPool.drop();

    await assert.rejects(
      () => queued,
      (error) => error.cancelled === true && /cancelled before it started/.test(error.message),
      'a dropped request must settle; leaving it pending is what hung the delete dialog',
    );
    await Promise.all(inFlight);
  });

  describe('toRegistryError', () => {
    it('should turn the coded object form into a readable message', () => {
      const error = toRegistryError({ code: 'MIXED_CONTENT', url: 'http://registry.example' });
      // The object form used to reach the UI as "[object Object]".
      assert.match(error.message, /HTTPS/);
      assert.equal(error.code, 'MIXED_CONTENT');
      assert.equal(error.url, 'http://registry.example');
    });

    it('should pass strings and Errors through unchanged', () => {
      assert.equal(toRegistryError('plain trouble').message, 'plain trouble');
      const original = new Error('already an error');
      assert.equal(toRegistryError(original), original);
    });

    it('should still say something useful for an unrecognised code', () => {
      assert.match(toRegistryError({ code: 'WAT' }).message, /WAT/);
      assert.doesNotMatch(toRegistryError({}).message, /\[object Object\]/);
    });
  });

  describe('parseNextLink origin', () => {
    const base = 'https://registry.example/v2/app/tags/list';

    it('should not follow an absolute link to another origin', () => {
      assert.equal(parseNextLink('<https://evil.example/v2/app/tags/list?last=a>; rel="next"', base), undefined);
      assert.equal(parseNextLink('<http://registry.example/v2/app/tags/list?last=a>; rel="next"', base), undefined);
      assert.equal(parseNextLink('<//evil.example/x>; rel="next"', base), undefined);
    });

    it('should follow an absolute link to the same origin', () => {
      assert.equal(
        parseNextLink('<https://registry.example/v2/app/tags/list?last=a>; rel="next"', base),
        'https://registry.example/v2/app/tags/list?last=a',
      );
    });

    it('should require the registry path prefix when one is given', () => {
      const header = '</other/tags/list?last=a>; rel="next"';
      assert.equal(parseNextLink(header, base, 'https://registry.example/prefix'), undefined);
      assert.equal(
        parseNextLink('</prefix/v2/app/tags/list?last=a>; rel="next"', base, 'https://registry.example/prefix'),
        'https://registry.example/prefix/v2/app/tags/list?last=a',
      );
    });
  });

  describe('newestDate', () => {
    it('should compare as dates rather than as strings', () => {
      // Ordered the other way round as strings, because the second value's
      // offset carries it past midnight UTC into 2024-03-01T01:00Z.
      assert.equal(newestDate(['2024-03-01T00:00:00Z', '2024-02-29T20:00:00-05:00']), '2024-02-29T20:00:00-05:00');
    });

    it('should ignore missing and unparseable values', () => {
      assert.equal(newestDate([undefined, 'not a date', '2024-01-01T00:00:00Z']), '2024-01-01T00:00:00Z');
      assert.equal(newestDate([]), undefined);
      assert.equal(newestDate([null, 'nonsense']), undefined);
    });
  });

  describe('currentAliases', () => {
    it('should group every tag of a repository under the digest it resolves to', async () => {
      const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
      const { aliases } = await client.currentAliases('team/service-b');

      // Every tag of the fixture points at one manifest, which is exactly why
      // deleting that digest would take all of them.
      assert.equal(aliases.size, 1);
      assert.deepEqual([...aliases.values()][0].sort(), ['latest', 'v1.4.2']);
    });

    it('should refuse to report aliases when a manifest cannot be re-read', async () => {
      const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
      await assert.rejects(
        () => client.currentAliases('broken-manifest'),
        /nothing was deleted/,
        'an unverifiable repository must fail closed, not return a partial alias map',
      );
    });
  });

  describe('tags pagination', () => {
    it('should follow tags/list pages and see an alias on a later page', async () => {
      const paged = await createMockRegistry({ port: 0, tagPageSize: 2 });
      try {
        const client = new RegistryClient({ registryUrl: paged.url, onAuthentication: () => {} });
        const tags = await client.tags('nginx');
        assert.deepEqual(tags, ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
        const { aliases } = await client.currentAliases('nginx');
        assert.deepEqual([...aliases.values()][0].sort(), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
      } finally {
        await paged.close();
      }
    });

    const serveTags = async (link) => {
      const server = createServer((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Link',
          Link: link(req),
        });
        res.end(JSON.stringify({ name: 'r', tags: ['a'] }));
      });
      await new Promise((resolve) => server.listen(0, resolve));
      return { url: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
    };

    it('should throw rather than return a partial list when a next link is unparseable', async () => {
      const server = await serveTags(() => 'garbage; rel="next"');
      try {
        const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
        await assert.rejects(() => client.currentAliases('r'), /could not be followed/);
      } finally {
        await server.close();
      }
    });

    it('should throw when a next link loops back to a page already read', async () => {
      const server = await serveTags((req) => `<${req.url}>; rel="next"`);
      try {
        const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
        await assert.rejects(() => client.tags('r'), /already read/);
      } finally {
        await server.close();
      }
    });
    it('should see every page even when a cached first page lost its Link header', async () => {
      sessionStorage.clear();
      const paged = await createMockRegistry({ port: 0, tagPageSize: 2 });
      try {
        const client = new RegistryClient({ registryUrl: paged.url, onAuthentication: () => {} });
        // The catalogue's tag count requests the same URL without an Accept
        // header, so it primes the cache entry tags() would otherwise replay.
        await client.request(`${paged.url}/v2/nginx/tags/list`);
        assert.deepEqual(await client.tags('nginx'), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
        assert.deepEqual(await client.tags('nginx'), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
      } finally {
        await paged.close();
      }
    });

    it('should refuse a next link that points at another origin', async () => {
      let victimHits = 0;
      const victim = await serveTags(() => {
        victimHits++;
        return '';
      });
      const server = await serveTags(() => `<${victim.url}/v2/r/tags/list?last=a>; rel="next"`);
      try {
        const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
        await assert.rejects(() => client.tags('r'), /could not be followed/);
        assert.equal(victimHits, 0, 'no request may reach the other origin');
      } finally {
        await server.close();
        await victim.close();
      }
    });

    it('should refuse a next link outside the registry base path', async () => {
      const server = await serveTags(() => '</elsewhere/tags/list?last=a>; rel="next"');
      try {
        const client = new RegistryClient({ registryUrl: `${server.url}/prefix`, onAuthentication: () => {} });
        await assert.rejects(() => client.tags('r'), /could not be followed/);
      } finally {
        await server.close();
      }
    });

    it('should stop after the page cap instead of paging forever', async () => {
      let pages = 0;
      const server = await serveTags(() => `</v2/r/tags/list?last=${++pages}>; rel="next"`);
      try {
        const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
        await assert.rejects(() => client.tags('r', { maxPages: 5 }), /more than 5 pages/);
        assert.equal(pages, 5);
      } finally {
        await server.close();
      }
    });
  });

  describe('fail-closed guards', () => {
    let reg;
    afterEach(async () => {
      sessionStorage.clear();
      await reg?.close();
    });

    const fakeDigest = (n) => `sha256:${String(n).padStart(64, '0')}`;
    const ATTESTATION = { 'vnd.docker.reference.type': 'attestation-manifest' };

    const withAttestation = async () => {
      reg = await createFake();
      const child = reg.image('amd64', '2020-01-01T00:00:00Z');
      // The attestation manifest itself is never stored: it must be recorded from
      // the descriptor alone, without being fetched.
      const attestation = fakeDigest(777);
      const index = reg.raw(fakeDigest(1), {
        manifests: [
          {
            mediaType: child.mediaType,
            digest: child.digest,
            size: child.size,
            platform: { os: 'linux', architecture: 'amd64' },
          },
          {
            mediaType: OCI_M,
            digest: attestation,
            size: 1,
            platform: { os: 'unknown', architecture: 'unknown' },
            annotations: ATTESTATION,
          },
        ],
      });
      reg.tag('latest', index);
      return { attestation, child };
    };

    it('keeps attestation descriptor digests in inspectTag references', async () => {
      const { attestation, child } = await withAttestation();
      const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
      const record = await client.inspectTag('app', 'latest');
      assert.ok(record.references.includes(attestation), 'attestation digest missing from references');
      assert.ok(record.references.includes(child.digest));
      assert.equal(record.platforms.length, 1, 'the attestation is not a platform');
    });

    it('keeps attestation descriptor digests in currentAliases referenced', async () => {
      const { attestation } = await withAttestation();
      const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
      const { referenced } = await client.currentAliases('app');
      assert.deepEqual(referenced.get(attestation), ['latest']);
    });

    it('currentAliases throws, rather than swallowing, when a nested index walk fails', async () => {
      reg = await createFake();
      const missing = fakeDigest(404);
      reg.tag('latest', reg.raw(fakeDigest(2), { manifests: [{ mediaType: OCI_M, digest: missing, size: 1 }] }));
      const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
      await assert.rejects(
        () => client.currentAliases('app'),
        /Could not read the contents of index app:latest.*nothing was deleted/,
      );
    });

    describe('catalogue paging', () => {
      const serveCatalog = async (link) => {
        const server = createServer((req, res) => {
          const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 0);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Link',
            Link: link(page),
          });
          res.end(JSON.stringify({ repositories: [`repo${page}`] }));
        });
        await new Promise((resolve) => server.listen(0, resolve));
        return { url: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
      };

      it('allRepositories stops at the page cap instead of looping forever', async () => {
        // A registry that never stops advertising a distinct next page.
        const server = await serveCatalog((page) => `</v2/_catalog?page=${page + 1}>; rel="next"`);
        try {
          const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
          await assert.rejects(() => client.allRepositories({ maxPages: 3 }), /more than 3 pages/);
        } finally {
          await server.close();
        }
      });

      it('catalogPage throws when the next page could not be followed (off-origin Link)', async () => {
        const server = await serveCatalog(() => '<https://evil.example/v2/_catalog?last=a>; rel="next"');
        try {
          const client = new RegistryClient({ registryUrl: server.url, onAuthentication: () => {} });
          await assert.rejects(() => client.catalogPage(), /next page that could not be followed/);
          await assert.rejects(() => client.allRepositories(), /could not be followed/);
        } finally {
          await server.close();
        }
      });
    });

    describe('walkIndex', () => {
      it('terminates on an index that lists itself', async () => {
        reg = await createFake();
        const self = fakeDigest(10);
        reg.tag('latest', reg.raw(self, { manifests: [{ mediaType: OCI_I, digest: self, size: 1 }] }));
        const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
        const root = await client.manifest('app', 'latest');
        const { references } = await client.walkIndex('app', root, { fetchLeaves: true });
        assert.deepEqual([...references], [self]);
      });

      it('terminates on a two-index cycle', async () => {
        reg = await createFake();
        const [a, b] = [fakeDigest(11), fakeDigest(12)];
        reg.tag('latest', reg.raw(a, { manifests: [{ mediaType: OCI_I, digest: b, size: 1 }] }));
        reg.raw(b, { manifests: [{ mediaType: OCI_I, digest: a, size: 1 }] });
        const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
        const { referenced } = await client.currentAliases('app');
        assert.deepEqual([...referenced.keys()].sort(), [a, b]);
      });

      const chain = (levels) => {
        // levels indexes deep: 1 -> 2 -> ... -> levels -> one real image.
        const image = reg.image('amd64', '2020-01-01T00:00:00Z');
        let child = image;
        for (let level = levels; level >= 1; level--) {
          child = reg.raw(fakeDigest(100 + level), {
            manifests: [{ mediaType: child.mediaType, digest: child.digest, size: 1 }],
          });
        }
        return child;
      };

      it('follows nesting up to the depth limit', async () => {
        reg = await createFake();
        reg.tag('latest', chain(MAX_INDEX_DEPTH));
        const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
        const { referenced } = await client.currentAliases('app');
        assert.equal(referenced.size, MAX_INDEX_DEPTH);
      });

      it('fails closed when indexes nest deeper than the limit', async () => {
        reg = await createFake();
        reg.tag('latest', chain(MAX_INDEX_DEPTH + 2));
        const client = new RegistryClient({ registryUrl: reg.url, onAuthentication: () => {} });
        await assert.rejects(() => client.inspectTag('app', 'latest'), /nested more than 8 levels/);
        await assert.rejects(() => client.currentAliases('app'), /nothing was deleted/);
      });
    });
  });
});
