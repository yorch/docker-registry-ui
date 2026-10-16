// currentAliases re-reads every tag before a delete, classifying by body, and
// reports progress while it does.
import assert from 'node:assert';
import { component } from 'riot';
import ConfirmDeleteImage from '../src/components/dialogs/confirm-delete-image.riot';
import { RegistryClient } from '../src/scripts/registry-client.js';
import { createFake, OCI_M } from './support/fake-registry.js';

const OLD = '2020-01-01T00:00:00Z';
const PLAIN = 10;

describe('currentAliases', () => {
  let reg;
  afterEach(async () => {
    document.body.replaceChildren();
    sessionStorage.clear();
    await reg?.close();
  });
  const start = async (options) => {
    reg = await createFake(options);
    const images = [];
    for (let i = 0; i < PLAIN; i++) {
      images.push(reg.image(`p${i}`, OLD));
      reg.tag(`plain-${String(i).padStart(2, '0')}`, images[i]);
    }
    return { images, client: new RegistryClient({ registryUrl: reg.url }) };
  };
  const mount = (props) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return component(ConfirmDeleteImage)(root, {
      registryUrl: reg.url,
      onNotify: () => {},
      onAuthentication: () => {},
      onClick: () => {},
      onImageDeleted: async () => {},
      opened: true,
      ...props,
    });
  };

  it('reports progress as done/total, ending at the total', async () => {
    const { client } = await start();
    const seen = [];
    await client.currentAliases('app', { onProgress: (progress) => seen.push({ ...progress }) });
    assert.equal(seen.at(-1).done, PLAIN);
    assert.equal(seen.at(-1).total, PLAIN);
    const dones = seen.map((p) => p.done);
    assert.deepEqual(
      dones,
      [...dones].sort((a, b) => a - b),
    );
  });

  it('shows how far the tag check has got while the dialog runs it', async () => {
    const { images } = await start({ delayMs: 5 });
    const shown = [{ name: 'app', tag: 'plain-05', contentDigest: images[5].digest }];
    const instance = mount({ tags: shown, toDelete: new Set(shown) });
    const root = instance.root;
    const seen = [];
    const timer = setInterval(() => {
      const match = /Checking tags (\d+)\/(\d+)/.exec(root.textContent);
      if (match) seen.push(match.slice(1).map(Number));
    }, 2);
    await instance.deleteImages();
    clearInterval(timer);
    assert.ok(seen.length > 0, 'no progress text was rendered');
    assert.ok(seen.every(([, total]) => total === PLAIN));
    assert.equal(instance.state.progress, undefined);
    assert.doesNotMatch(root.textContent, /Checking tags/);
  });

  describe('an index served with an image Content-Type', () => {
    // Body has manifests[]; the registry labels it (and the body) as an image.
    const confusedIndex = async () => {
      const setup = await start();
      const child = reg.image('amd64', OLD);
      reg.tag('child', child);
      reg.tag('latest', reg.index([child], OCI_M));
      return { ...setup, child };
    };

    it('still reports its children as referenced', async () => {
      const { client, child } = await confusedIndex();
      const { referenced } = await client.currentAliases('app');
      assert.deepEqual(referenced.get(child.digest), ['latest']);
    });

    it('makes the dialog refuse to delete a child', async () => {
      const { child } = await confusedIndex();
      const notes = [];
      const shown = [{ name: 'app', tag: 'child', contentDigest: child.digest }];
      await mount({ tags: shown, toDelete: new Set(shown), onNotify: (m, e) => notes.push({ m, e }) }).deleteImages();
      assert.deepEqual(reg.deletes, []);
      assert.ok(reg.exists(child.digest));
      assert.match(notes[0].m, /part of index app:latest/);
    });
  });
});
