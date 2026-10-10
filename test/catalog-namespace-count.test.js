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
const badge = (root, word) =>
  [...root.querySelectorAll('.catalog-stats .badge')].map((el) => el.textContent.trim()).find((t) => t.endsWith(word));

describe('catalog namespace count', function () {
  this.timeout(20000);
  let registry;
  let root;

  const mount = async (names) => {
    registry = await createMockRegistry({ port: 0, fixtures: names.map(fixture) });
    root = document.createElement('div');
    document.body.appendChild(root);
    component(CatalogHost)(root, { registryUrl: registry.url });
    await until(() => badge(root, 'namespaces'), 'catalog never rendered');
  };

  beforeEach(() => sessionStorage.clear());
  afterEach(async () => {
    document.body.replaceChildren();
    await registry?.close();
  });

  it('should not count bare repositories as namespaces', async () => {
    await mount(['nginx', 'redis', 'team/a']);
    assert.equal(badge(root, 'namespaces'), '1 namespaces');
    assert.equal(badge(root, 'repositories'), '3 repositories');
  });
});
