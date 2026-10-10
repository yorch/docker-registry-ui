import assert from 'node:assert';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import ConfirmDeleteImage from '../src/components/dialogs/confirm-delete-image.riot';
import { MANIFEST_ACCEPT } from '../src/scripts/registry-client.js';

const NGINX_TAGS = ['latest', '1.27', '1.27.3', '1.26', 'stable'];

describe('confirm-delete-image', () => {
  let registry;
  let notes;
  let closed;
  let deletedCallbacks;

  const digestOf = async (name, tag) =>
    (await fetch(`${registry.url}/v2/${name}/manifests/${tag}`, { headers: { Accept: MANIFEST_ACCEPT } })).headers.get(
      'Docker-Content-Digest',
    );

  const image = (name, tag, contentDigest) => ({ name, tag, contentDigest });

  const mount = (props) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return component(ConfirmDeleteImage)(root, {
      registryUrl: registry.url,
      onNotify: (message, isError) => notes.push({ message: message?.message || message, isError }),
      onAuthentication: () => {},
      onClick: () => {
        closed += 1;
      },
      onImageDeleted: async () => {
        deletedCallbacks += 1;
      },
      opened: true,
      ...props,
    });
  };

  const shownTags = async (name, tags, digest) => tags.map((tag) => image(name, tag, digest));

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
    notes = [];
    closed = 0;
    deletedCallbacks = 0;
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await registry.close();
  });

  it('should send one DELETE for two aliases of one digest', async () => {
    const digest = await digestOf('nginx', 'latest');
    const all = await shownTags('nginx', NGINX_TAGS, digest);
    const toDelete = new Set([all[0], all[1]]);
    const instance = mount({ tags: all, toDelete });
    await instance.deleteImages();

    assert.equal(registry.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 1);
    assert.equal(notes.filter((note) => note.isError).length, 0, JSON.stringify(notes));
    assert.equal(toDelete.size, 0);
    assert.equal(deletedCallbacks, 1);
    assert.equal(closed, 1);
    assert.equal(instance.state.deleting, false);
    assert.equal((await fetch(`${registry.url}/v2/nginx/tags/list`).then((r) => r.json())).tags, null);
  });

  it('should abort with no DELETE when the digest changed since the list loaded', async () => {
    const stale = `sha256:${'0'.repeat(64)}`;
    const all = await shownTags('nginx', NGINX_TAGS, stale);
    const instance = mount({ tags: all, toDelete: new Set([all[0]]) });
    await instance.deleteImages();

    assert.equal(registry.requestCount(`/v2/nginx/manifests/${stale}`, 'DELETE'), 0);
    const digest = await digestOf('nginx', 'latest');
    assert.equal(registry.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 0);
    assert.match(notes[0].message, /changed since this list loaded/);
    assert.equal(notes[0].isError, true);
    assert.equal(instance.state.deleting, false);
    assert.equal(closed, 1);
  });

  it('should abort with no DELETE when a sibling tag was never shown', async () => {
    const digest = await digestOf('nginx', 'latest');
    // The registry has five tags on this digest; the dialog only knew of three.
    const all = await shownTags('nginx', NGINX_TAGS.slice(0, 3), digest);
    const instance = mount({ tags: all, toDelete: new Set([all[0]]) });
    await instance.deleteImages();

    assert.equal(registry.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 0);
    assert.match(notes[0].message, /Tags changed/);
    assert.equal(instance.state.deleting, false);
  });

  it('should fail closed when a sibling lives on a later tags page', async () => {
    const paged = await createMockRegistry({ port: 0, tagPageSize: 2 });
    try {
      const digest = (
        await fetch(`${paged.url}/v2/nginx/manifests/latest`, { headers: { Accept: MANIFEST_ACCEPT } })
      ).headers.get('Docker-Content-Digest');
      const all = NGINX_TAGS.slice(0, 2).map((tag) => image('nginx', tag, digest));
      const instance = mount({ registryUrl: paged.url, tags: all, toDelete: new Set([all[0]]) });
      await instance.deleteImages();
      assert.equal(paged.requestCount(`/v2/nginx/manifests/${digest}`, 'DELETE'), 0);
      assert.match(notes[0].message, /Tags changed/);
    } finally {
      await paged.close();
    }
  });

  it('should report a missing manifest and delete nothing', async () => {
    const all = [image('nginx', 'nope', `sha256:${'1'.repeat(64)}`)];
    const instance = mount({ tags: all, toDelete: new Set(all) });
    await instance.deleteImages();
    assert.match(notes[0].message, /nginx:nope not found/);
    assert.equal(instance.state.deleting, false);
  });

  it('should report a network failure reading the digest instead of an empty message', async () => {
    const digest = await digestOf('nginx', 'latest');
    const all = await shownTags('nginx', NGINX_TAGS, digest);
    const instance = mount({ tags: all, toDelete: new Set([all[0]]) });
    await registry.close();
    await instance.deleteImages();
    assert.ok(notes[0].message, 'the snackbar must not be empty');
    assert.equal(notes[0].isError, true);
    assert.equal(instance.state.deleting, false);
    assert.equal(closed, 1);
    registry = await createMockRegistry({ port: 0 });
  });

  it('should abort when the registry gives no digest the browser can establish', async () => {
    const digest = await digestOf('no-digest-header', 'latest');
    const all = [image('no-digest-header', 'latest', digest)];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      const instance = mount({ tags: all, toDelete: new Set(all) });
      await instance.deleteImages();
      assert.equal(registry.requestCount(`/v2/no-digest-header/manifests/${digest}`, 'DELETE'), 0);
      assert.equal(notes[0].isError, true);
      assert.equal(instance.state.deleting, false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });

  it('should surface a 405 from a registry with deletes disabled', async () => {
    const locked = await createMockRegistry({ port: 0, allowDelete: false });
    try {
      const digest = (
        await fetch(`${locked.url}/v2/nginx/manifests/latest`, { headers: { Accept: MANIFEST_ACCEPT } })
      ).headers.get('Docker-Content-Digest');
      const all = NGINX_TAGS.map((tag) => image('nginx', tag, digest));
      const toDelete = new Set([all[0]]);
      const instance = mount({ registryUrl: locked.url, tags: all, toDelete });
      await instance.deleteImages();
      assert.match(notes[0].message, /unsupported/i);
      assert.equal(notes[0].isError, true);
      assert.equal(toDelete.size, 1, 'a failed delete leaves the selection alone');
      assert.equal(deletedCallbacks, 0);
      assert.equal(instance.state.deleting, false);
    } finally {
      await locked.close();
    }
  });

  it('should surface a 404 when the manifest disappears between the check and the delete', async () => {
    const digest = await digestOf('nginx', 'latest');
    const all = await shownTags('nginx', NGINX_TAGS, digest);
    const instance = mount({ tags: all, toDelete: new Set([all[0]]) });
    const plan = await instance.planDeletes([all[0]]);
    await fetch(`${registry.url}/v2/nginx/manifests/${digest}`, { method: 'DELETE' });
    assert.equal(await instance.deleteDigest(plan[0]), false);
    assert.match(notes[0].message, /Digest not found/);
    assert.equal(notes[0].isError, true);
  });
});
