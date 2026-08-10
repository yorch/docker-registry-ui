import { newestDate, parseNextLink } from '../src/scripts/registry-client.js';
import { RegistryClient } from '../src/scripts/registry-client.js';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import assert from 'node:assert';

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
      const aliases = await client.currentAliases('team/service-b');

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
});
