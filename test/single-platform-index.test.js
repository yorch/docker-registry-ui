/*
 * An OCI index wrapping exactly one manifest is what buildx produces for a
 * single-platform build, and it is common in real registries. Treating every
 * index as multi-platform made those rows report "Multiple" for size and
 * creation date beside a single architecture badge -- two claims that cannot
 * both be true.
 *
 * Driven through DockerImage against the mock registry rather than stubbed:
 * the bug was in how the manifest response is interpreted, so a stub of that
 * response would have encoded the same mistake.
 */
import assert from 'node:assert';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import { DockerImage } from '../src/scripts/docker-image.js';

// Resolves once the row has everything it renders: size and creation date.
const inspect = (registryUrl, name, tag) =>
  new Promise((resolve, reject) => {
    const image = new DockerImage(name, tag, {
      list: true,
      registryUrl,
      onNotify: (message) => reject(new Error(`unexpected notification: ${JSON.stringify(message)}`)),
    });
    let sawSize = false;
    let sawDate = false;
    const settle = () => sawSize && sawDate && resolve(image);
    image.on('size', () => {
      sawSize = true;
      settle();
    });
    image.on('creation-date', () => {
      sawDate = true;
      settle();
    });
    image.fillInfo();
    setTimeout(() => reject(new Error('timed out waiting for size and creation date')), 10000);
  });

describe('single-platform index', () => {
  let registry;

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
  });

  afterEach(async () => {
    await registry.close();
  });

  it('should report a real size and date, not "Multiple"', async () => {
    const image = await inspect(registry.url, 'single-platform-index', 'latest');

    assert.equal(image.isIndex, false, 'one platform is not ambiguous, so nothing should read as Multiple');
    assert.ok(image.size > 0, `expected a real size, got ${image.size}`);
    assert.ok(image.creationDate instanceof Date, `expected a real date, got ${image.creationDate}`);
    assert.ok(!Number.isNaN(image.creationDate.getTime()));
  });

  it('should still expose the platform so the architecture column fills in', async () => {
    const image = await inspect(registry.url, 'single-platform-index', 'latest');
    assert.equal(image.manifests.length, 1);
    assert.equal(image.manifests[0].platform.architecture, 'amd64');
  });

  it('should keep the index digest rather than adopting the child manifest digest', async () => {
    // The tag resolves to the index, and a delete has to address that digest.
    const image = await inspect(registry.url, 'single-platform-index', 'latest');
    assert.match(image.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(image.contentDigest, image.manifests[0].digest);
  });

  it('should still report Multiple for a genuinely multi-platform index', async () => {
    const image = await inspect(registry.url, 'oci-index', 'latest');
    assert.equal(image.isIndex, true);
    assert.equal(image.size, null);
    assert.equal(image.creationDate, null);
    assert.equal(image.manifests.length, 3);
  });
});
