import assert from 'node:assert';
import { component } from 'riot';
import { fixtures } from '../dev/mock-registry/fixtures.js';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import TagListHost from './fixtures/tag-list-host.riot';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, message) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(30);
  }
  throw new Error(message);
};

const tagsShown = (root) =>
  [...root.querySelectorAll('tag-table tbody .tag-col image-tag')].map((el) => el.textContent.trim()).sort();

describe('tag list stale UI', function () {
  this.timeout(20000);

  let registry;
  let root;

  beforeEach(async () => {
    // The router calls the bare `history` global, which the jsdom setup does not expose.
    globalThis.history = window.history;
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    registry = await createMockRegistry({
      port: 0,
      fixtures: fixtures.map((fixture) => (fixture.name === 'oci-index' ? { ...fixture, delayMs: 400 } : fixture)),
    });
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(async () => {
    window.history.replaceState(null, '', '/');
    document.body.replaceChildren();
    await registry.close();
  });

  // H9: the reset for a new repository went through update() inside onUpdated,
  // which Riot does not patch, so the old rows (and their Delete buttons)
  // stayed on screen until the new tags arrived.
  it('should drop the old repository rows as soon as another one is requested', async () => {
    const host = component(TagListHost)(root, { image: 'nginx', registryUrl: registry.url, tagsPerPage: '' });
    await until(() => tagsShown(root).length === 5, 'nginx tags never rendered');

    host.update({ image: 'oci-index' });
    await wait(50);
    assert.deepEqual(tagsShown(root), [], 'the previous repository rows must be gone while the new one loads');
    assert.ok(root.querySelector('.skeleton-row'), 'the skeleton should be rendered while loading');

    await until(() => tagsShown(root).length === 2, 'oci-index tags never rendered');
    assert.deepEqual(tagsShown(root), ['latest', 'v3']);
  });

  // H9: the page=1 reset on a filter change had the same flaw, so searching
  // from page 2 left page 2 on screen.
  it('should show page 1 when a filter is set while on page 2', async () => {
    window.history.replaceState(null, '', '/?page=2');
    const host = component(TagListHost)(root, { image: 'exactly-100', registryUrl: registry.url, tagsPerPage: '10' });
    await until(() => tagsShown(root).length === 10, 'page 2 never rendered');
    // Newest first, so page 1 holds tag-0099..tag-0090 and page 2 the ten below.
    assert.ok(!tagsShown(root).includes('tag-0099'), 'precondition: page 2 does not hold the newest tag');

    host.update({ filter: 'tag-00' });
    assert.ok(tagsShown(root).includes('tag-0099'), 'the filtered list must start at page 1');
    assert.ok(!tagsShown(root).includes('tag-0089'), 'page 2 rows must be gone');
  });

  it('should remove its window resize listener on unmount', async () => {
    const added = [];
    const removed = [];
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = function (type, fn, ...rest) {
      if (type === 'resize') added.push(fn);
      return add.call(this, type, fn, ...rest);
    };
    window.removeEventListener = function (type, fn, ...rest) {
      if (type === 'resize') removed.push(fn);
      return remove.call(this, type, fn, ...rest);
    };
    try {
      const host = component(TagListHost)(root, { image: 'nginx', registryUrl: registry.url, tagsPerPage: '' });
      await until(() => tagsShown(root).length === 5, 'nginx tags never rendered');
      host.unmount();
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
    assert.equal(added.length, 1);
    assert.deepEqual(removed, added);
  });
});
