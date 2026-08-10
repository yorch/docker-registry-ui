import { parseNextLink } from '../src/scripts/registry-client.js';
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
});
