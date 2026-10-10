import assert from 'node:assert';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import { MAX_CONCURRENT_REQUESTS, requestPool } from '../src/scripts/request-pool.js';
import CatalogHost from './fixtures/stale-ui-catalog-host.riot';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fixture = (name) => ({ name, tags: ['latest'], architecture: 'amd64', layerSizes: [1000] });

describe('catalog request pool ownership', function () {
  this.timeout(20000);
  const registries = [];
  const held = [];

  afterEach(async () => {
    held.splice(0).forEach((done) => done());
    requestPool.drop();
    document.body.replaceChildren();
    await Promise.all(registries.splice(0).map((registry) => registry.close()));
  });

  it("should not cancel another screen's queued work when the registry changes", async () => {
    const first = await createMockRegistry({ port: 0, fixtures: [fixture('a')] });
    const second = await createMockRegistry({ port: 0, fixtures: [fixture('b')] });
    registries.push(first, second);
    // Fill every slot so anything submitted after this stays queued.
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
      requestPool.submit((done) => held.push(done));
    }
    let foreignDropped = false;
    requestPool.submit(
      () => {},
      () => {
        foreignDropped = true;
      },
      {},
    );

    const root = document.createElement('div');
    document.body.appendChild(root);
    const host = component(CatalogHost)(root, { registryUrl: first.url });
    await wait(200);
    host.update({ registryUrl: second.url });
    await wait(200);

    assert.equal(foreignDropped, false, 'a catalog switching registries must only drop its own queued work');
  });
});
