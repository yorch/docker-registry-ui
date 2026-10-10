/*
 * The failure branches of deleting and of walking the catalogue. The happy
 * paths and the alias guards are covered in delete-confirm.test.js and
 * registry-client.test.js; these are the ways a registry says no, and what the
 * user is told when it does.
 */
import assert from 'node:assert';
import { createServer } from 'node:http';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import ConfirmDeleteImage from '../src/components/dialogs/confirm-delete-image.riot';
import { MANIFEST_ACCEPT, RegistryClient } from '../src/scripts/registry-client.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, DELETE',
  'Access-Control-Expose-Headers': 'Link',
};

// A registry that answers every request through `handler(req, res, log)`.
const serve = async (handler) => {
  const log = [];
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    log.push(`${req.method} ${req.url}`);
    handler(req, res, log);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return {
    url: `http://localhost:${server.address().port}`,
    log,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(JSON.stringify(body));
};

describe('RegistryClient.deleteManifest', () => {
  let registry;
  let client;

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
    client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
  });

  afterEach(async () => {
    await registry.close();
  });

  const digestOf = async (name, tag) =>
    (await fetch(`${registry.url}/v2/${name}/manifests/${tag}`, { headers: { Accept: MANIFEST_ACCEPT } })).headers.get(
      'Docker-Content-Digest',
    );

  it('should DELETE by digest and make the manifest disappear', async () => {
    const digest = await digestOf('nginx', 'latest');
    await client.deleteManifest('nginx', digest);
    assert.equal(registry.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 1);
    const after = await fetch(`${registry.url}/v2/nginx/manifests/${digest}`, { headers: { Accept: MANIFEST_ACCEPT } });
    assert.equal(after.status, 404);
  });

  it('should reject with status 404 for a digest the registry does not hold', async () => {
    await assert.rejects(
      () => client.deleteManifest('nginx', `sha256:${'f'.repeat(64)}`),
      (error) => error.status === 404,
    );
  });

  it('should reject with status 405 when the registry has deletes disabled', async () => {
    const locked = await createMockRegistry({ port: 0, allowDelete: false });
    try {
      const lockedClient = new RegistryClient({ registryUrl: locked.url, onAuthentication: () => {} });
      const digest = (
        await fetch(`${locked.url}/v2/nginx/manifests/latest`, { headers: { Accept: MANIFEST_ACCEPT } })
      ).headers.get('Docker-Content-Digest');
      await assert.rejects(
        () => lockedClient.deleteManifest('nginx', digest),
        (error) => error.status === 405,
      );
    } finally {
      await locked.close();
    }
  });

  it('should reject without a status when the registry cannot be reached', async () => {
    const digest = await digestOf('nginx', 'latest');
    await registry.close();
    try {
      await assert.rejects(
        () => client.deleteManifest('nginx', digest),
        (error) => error.status === undefined && Boolean(error.message),
      );
    } finally {
      registry = await createMockRegistry({ port: 0 });
    }
  });

  it('should not serve a cached answer for a repeat DELETE', async () => {
    const digest = await digestOf('nginx', 'latest');
    await client.deleteManifest('nginx', digest);
    // If the second call were answered from a cache it would resolve.
    await assert.rejects(
      () => client.deleteManifest('nginx', digest),
      (error) => error.status === 404,
    );
    assert.equal(registry.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 2);
  });
});

describe('confirm-delete-image failure messages', () => {
  let notes;

  beforeEach(() => {
    notes = [];
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const entry = { name: 'nginx', digest: `sha256:${'a'.repeat(64)}`, images: [{ name: 'nginx', tag: 'latest' }] };

  const mount = (props) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return component(ConfirmDeleteImage)(root, {
      onNotify: (message, isError) => notes.push({ message: message?.message || message, isError }),
      onAuthentication: () => {},
      onClick: () => {},
      onImageDeleted: async () => {},
      opened: true,
      tags: [],
      toDelete: new Set(),
      ...props,
    });
  };

  it('should point at CORS when the DELETE never gets an HTTP answer', async () => {
    // A preflight the registry refuses surfaces in the browser as a bare network
    // error, with no status to branch on.
    const registry = await serve(() => {});
    const url = registry.url;
    await registry.close();
    const instance = mount({ registryUrl: url });

    assert.equal(await instance.deleteDigest(entry), false);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].isError, true);
    assert.match(notes[0].message, /Access-Control-Allow-Methods/);
    assert.doesNotMatch(notes[0].message, /issue #104/, 'the credential hint is only for secured registries');
  });

  it('should add the credentials hint when the registry is secured', async () => {
    const registry = await serve(() => {});
    const url = registry.url;
    await registry.close();
    const instance = mount({ registryUrl: url, isRegistrySecured: true });

    assert.equal(await instance.deleteDigest(entry), false);
    assert.match(notes[0].message, /Access-Control-Allow-Methods/);
    assert.match(notes[0].message, /issue #104/);
  });

  it('should name the repository and the registry message for a server error', async () => {
    const registry = await serve((_req, res) => json(res, 500, { errors: [{ message: 'storage backend offline' }] }));
    try {
      const instance = mount({ registryUrl: registry.url });
      assert.equal(await instance.deleteDigest(entry), false);
      assert.deepEqual(notes, [{ message: 'Could not delete nginx: storage backend offline', isError: true }]);
    } finally {
      await registry.close();
    }
  });

  it('should stay silent about a 404 when told to ignore errors', async () => {
    const registry = await serve((_req, res) => json(res, 404, { errors: [{ message: 'gone' }] }));
    try {
      const instance = mount({ registryUrl: registry.url, ignoreError: true });
      assert.equal(await instance.deleteDigest(entry), false);
      assert.deepEqual(notes, []);
    } finally {
      await registry.close();
    }
  });

  it('should not report success for a failed delete', async () => {
    const registry = await serve((_req, res) => json(res, 500, { errors: [{ message: 'nope' }] }));
    try {
      const instance = mount({ registryUrl: registry.url });
      await instance.deleteDigest(entry);
      assert.ok(
        notes.every((note) => note.isError),
        `a failed delete must never emit the success note: ${JSON.stringify(notes)}`,
      );
    } finally {
      await registry.close();
    }
  });
});

describe('allRepositories traversal failures', () => {
  const catalog = (pages, { failAt } = {}) =>
    serve((req, res) => {
      const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 0);
      if (page === failAt) return json(res, 500, { errors: [{ message: 'catalogue unavailable' }] });
      const link = page + 1 < pages ? { Link: `</v2/_catalog?page=${page + 1}>; rel="next"` } : {};
      json(res, 200, { repositories: [`repo${page}`] }, link);
    });

  it('should return only what was read when cancelled between pages, and ask for no more', async () => {
    const registry = await catalog(5);
    try {
      const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
      let reads = 0;
      const result = await client.allRepositories({ onProgress: () => (reads += 1), isCancelled: () => reads >= 2 });
      assert.deepEqual(result, ['repo0', 'repo1']);
      assert.equal(registry.log.length, 2, `expected two catalogue requests, got ${registry.log.join(', ')}`);
    } finally {
      await registry.close();
    }
  });

  it('should make no request at all when cancelled before it starts', async () => {
    const registry = await catalog(5);
    try {
      const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
      assert.deepEqual(await client.allRepositories({ isCancelled: () => true }), []);
      assert.deepEqual(registry.log, []);
    } finally {
      await registry.close();
    }
  });

  it('should reject, not return a partial list, when a later page fails', async () => {
    const registry = await catalog(5, { failAt: 2 });
    try {
      const client = new RegistryClient({ registryUrl: registry.url, onAuthentication: () => {} });
      const progress = [];
      await assert.rejects(
        () => client.allRepositories({ onProgress: (state) => progress.push(state.repositories) }),
        (error) => error.status === 500 && /catalogue unavailable/.test(error.message),
      );
      // Progress was reported for the pages that did load, so a UI can show them,
      // but the call itself must not resolve as though the list were complete.
      assert.deepEqual(progress, [['repo0'], ['repo0', 'repo1']]);
    } finally {
      await registry.close();
    }
  });
});
