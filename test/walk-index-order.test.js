import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { RegistryClient } from '../src/scripts/registry-client.js';

const leaf = (digest) => ({
  digest,
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  layers: [],
});
const descriptor = (digest) => ({ digest, mediaType: 'application/vnd.oci.image.manifest.v1+json' });

describe('RegistryClient.walkIndex', () => {
  it('returns leaves in index order however the fetches finish', async () => {
    const client = new RegistryClient({ registryUrl: 'http://registry.test', onAuthentication: () => {} });
    // The first child resolves last, so completion order is the reverse of index order.
    const delays = { 'sha256:a': 30, 'sha256:b': 15, 'sha256:c': 0 };
    client.manifest = (_repository, digest) =>
      new Promise((resolve) => setTimeout(() => resolve(leaf(digest)), delays[digest]));
    const root = { digest: 'sha256:root', manifests: ['sha256:a', 'sha256:b', 'sha256:c'].map(descriptor) };

    const { leaves } = await client.walkIndex('repo', root, { fetchLeaves: true });

    assert.deepEqual(
      leaves.map((entry) => entry.descriptor.digest),
      ['sha256:a', 'sha256:b', 'sha256:c'],
    );
  });
});
