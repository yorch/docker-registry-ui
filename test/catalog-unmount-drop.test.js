import assert from 'node:assert';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import { MAX_CONCURRENT_REQUESTS, requestPool } from '../src/scripts/request-pool.js';
import Host from './fixtures/catalog-counts-host.riot';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fixture = (name) => ({ name, tags: ['latest'], architecture: 'amd64', layerSizes: [1000] });

describe('catalog unmount', function () {
  this.timeout(20000);
  const held = [];
  let registry;

  afterEach(async () => {
    held.splice(0).forEach((done) => done());
    requestPool.drop();
    document.body.replaceChildren();
    await registry?.close();
  });

  it('should not leave its queued tag counts behind', async () => {
    registry = await createMockRegistry({ port: 0, fixtures: Array.from({ length: 40 }, (_, i) => fixture(`r${i}`)) });
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) requestPool.submit((done) => held.push(done));
    // Other test files can leave work queued in the shared pool.
    const baseline = requestPool.queue.length;
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host = component(Host)(root, { registryUrl: registry.url });
    await wait(300);
    assert.ok(requestPool.queue.length > baseline, 'precondition: tag counts are queued');
    host.unmount();
    assert.equal(requestPool.queue.length, baseline, 'the unmounted catalog must not keep work queued');
  });
});
