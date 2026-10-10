import assert from 'node:assert';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import CatalogHost from './fixtures/stale-ui-catalog-host.riot';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, message) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(30);
  }
  throw new Error(message);
};

const fixture = (name) => ({ name, tags: ['latest'], architecture: 'amd64', layerSizes: [1000] });

// Row labels: leaf repositories and namespace folders, in document order.
const labels = (root) => [...root.querySelectorAll('catalog-element .row-label')].map((el) => el.textContent.trim());

describe('catalog stale UI', function () {
  this.timeout(20000);

  let registries;
  let root;

  const startRegistry = async (names, options = {}) => {
    const registry = await createMockRegistry({ port: 0, fixtures: names.map(fixture), ...options });
    registries.push(registry);
    return registry;
  };

  beforeEach(() => {
    registries = [];
    sessionStorage.clear();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await Promise.all(registries.map((registry) => registry.close()));
  });

  // H8: an unkeyed `each` matches rows by index, so a list that grows in the
  // middle reused the third row for "c" and showed "a, c, c".
  it('should render every row when the registry changes from [a, c] to [a, b, c]', async () => {
    const first = await startRegistry(['a', 'c']);
    const second = await startRegistry(['a', 'b', 'c']);
    const host = component(CatalogHost)(root, { registryUrl: first.url });
    await until(() => labels(root).length === 2, 'first registry never rendered');
    assert.deepEqual(labels(root), ['a', 'c']);

    host.update({ registryUrl: second.url });
    await until(() => labels(root).length === 3, 'second registry never rendered');
    assert.deepEqual(labels(root), ['a', 'b', 'c']);
  });

  // H9: the reset ran through update() inside onUpdated, which Riot skips
  // patching, so the previous registry's rows stayed on screen until the new
  // list arrived.
  it('should show the loading state and drop the old rows while the new registry loads', async () => {
    const first = await startRegistry(['a', 'c']);
    const slow = await startRegistry(['x', 'y'], { latency: 400 });
    const host = component(CatalogHost)(root, { registryUrl: first.url });
    await until(() => labels(root).length === 2, 'first registry never rendered');

    host.update({ registryUrl: slow.url });
    await wait(50);
    assert.ok(root.querySelector('.skeleton-row'), 'the skeleton should be rendered while loading');
    assert.deepEqual(labels(root), [], 'the previous registry rows must be gone');

    await until(() => labels(root).length === 2, 'slow registry never rendered');
    assert.deepEqual(labels(root), ['x', 'y']);
  });

  // H8: a namespace keeps its key while its children change, so it has to
  // update in place. "team" starts as a lone repository (rendered as a leaf)
  // and turns into a folder when the second page adds a sibling.
  it('should turn a lone-repository namespace into a folder when load more adds a sibling', async () => {
    const registry = await startRegistry(['team/x', 'team/y']);
    component(CatalogHost)(root, { registryUrl: registry.url, limit: 1 });
    await until(() => labels(root).length === 1, 'first page never rendered');
    assert.deepEqual(labels(root), ['team/x'], 'precondition: a lone repository renders as a leaf');

    const loadMore = [...root.querySelectorAll('.catalog-pagination button')].find((b) =>
      b.textContent.includes('Load More'),
    );
    loadMore.click();
    await until(() => labels(root).includes('team/'), 'the namespace never became a folder');
    assert.ok(root.querySelector('catalog-element button.row-main'), 'a folder row is expected');
    assert.deepEqual(labels(root).slice(0, 1), ['team/']);
  });
});
