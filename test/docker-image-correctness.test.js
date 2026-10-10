import assert from 'node:assert';
import { DockerImage, supportListManifest } from '../src/scripts/docker-image.js';
import { createFake, DOCKER_L, DOCKER_M, OCI_I, OCI_M } from './support/fake-registry.js';

// Waits for the first of the terminal events a row renders from.
const load = (registryUrl, tag, { list = true, wait = ['creation-date'] } = {}) =>
  new Promise((resolve, reject) => {
    const notes = [];
    const image = new DockerImage('app', tag, {
      list,
      registryUrl,
      onNotify: (message) => notes.push(message),
    });
    const seen = new Set();
    wait.forEach((event) =>
      image.on(event, () => {
        seen.add(event);
        if (seen.size === wait.length) resolve({ image, notes });
      }),
    );
    image.fillInfo();
    setTimeout(() => reject(new Error(`timed out waiting for ${wait} (notes: ${JSON.stringify(notes)})`)), 5000);
  });

describe('DockerImage correctness', () => {
  let fake;

  beforeEach(async () => {
    fake = await createFake();
  });

  afterEach(async () => {
    await fake.close();
  });

  describe('OCI index whose children are Docker v2 manifests (M-COR-3)', () => {
    it('should be listed as an index rather than summed as one image', () => {
      assert.ok(
        supportListManifest({
          mediaType: OCI_I,
          manifests: [
            { mediaType: DOCKER_M, digest: 'sha256:a' },
            { mediaType: DOCKER_M, digest: 'sha256:b' },
          ],
        }),
      );
    });

    it('should still reject an index whose children are layers', () => {
      assert.ok(
        !supportListManifest({
          mediaType: OCI_I,
          manifests: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: 'sha256:a' }],
        }),
      );
    });

    it('should report one Docker child by its real size and date', async () => {
      const child = fake.image('amd64', '2025-05-05T00:00:00Z', DOCKER_M);
      fake.tag('one', fake.index([child]));
      const { image } = await load(fake.url, 'one', { wait: ['size', 'creation-date'] });
      assert.equal(image.size, 10, 'the child layer size, not the descriptor bytes');
      assert.equal(image.creationDate.toISOString(), '2025-05-05T00:00:00.000Z');
    });

    it('should not claim a size or date for a nested index it cannot list', async () => {
      const leaf = fake.image('amd64', '2025-05-05T00:00:00Z');
      const inner = fake.index([leaf]);
      fake.tag('nested', fake.index([{ ...inner, mediaType: OCI_I }]));
      const { image } = await load(fake.url, 'nested', { wait: ['size', 'creation-date'] });
      assert.equal(image.size, null);
      assert.equal(image.creationDate, null);
    });
  });

  it('should not produce an Invalid Date when neither created nor the annotation exists (M-COR-4)', async () => {
    fake.tag('nodate', fake.image('amd64', undefined));
    const { image } = await load(fake.url, 'nodate', { wait: ['creation-date', 'blobs'] });
    assert.equal(image.creationDate, null);
  });

  it('should still render history when it has more entries than layers (M-COR-5)', async () => {
    const history = [{ created_by: 'a' }, { created_by: 'b' }, { created_by: 'c' }];
    fake.tag('misaligned', fake.image('amd64', '2025-05-05T00:00:00Z', OCI_M, { history }));
    const { image, notes } = await load(fake.url, 'misaligned', { wait: ['creation-date', 'blobs'] });
    assert.equal(image.blobs.history.length, 3);
    assert.equal(image.creationDate.getUTCFullYear(), 2025);
    assert.deepEqual(notes, []);
  });

  it('should survive an empty manifest list', async () => {
    fake.tag('empty', fake.raw(`sha256:${'e'.repeat(64)}`, { manifests: [] }, DOCKER_L));
    const { image } = await load(fake.url, 'empty', { wait: ['size', 'creation-date'] });
    assert.equal(image.size, null);
    assert.equal(image.creationDate, null);
  });

  it('should mark a schema 1 manifest unavailable instead of throwing', async () => {
    fake.tag('legacy', fake.raw(`sha256:${'f'.repeat(64)}`, { schemaVersion: 1, fsLayers: [] }, DOCKER_M));
    const { image } = await load(fake.url, 'legacy', { wait: ['size', 'creation-date'] });
    assert.equal(image.size, null);
    assert.equal(image.creationDate, null);
  });

  it('should name the blob digest in the not-found message', async () => {
    const missing = `sha256:${'9'.repeat(64)}`;
    fake.tag(
      'noblob',
      fake.raw(`sha256:${'8'.repeat(64)}`, { config: { digest: missing, size: 1 }, layers: [] }, OCI_M),
    );
    const notes = [];
    await new Promise((resolve) => {
      const image = new DockerImage('app', 'noblob', {
        list: false,
        registryUrl: fake.url,
        onNotify: (message) => {
          notes.push(message);
          resolve();
        },
      });
      image.fillInfo();
    });
    assert.match(notes[0], new RegExp(missing));
  });
});
