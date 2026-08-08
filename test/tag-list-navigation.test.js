import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import TagListHost from './fixtures/tag-list-host.riot';
import assert from 'assert';
import { fixtures } from '../dev/mock-registry/fixtures.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The tag rows render once the request has come back, so wait for the table
// rather than a fixed delay.
const waitForTags = async (root) => {
  for (let i = 0; i < 100; i++) {
    if (root.querySelectorAll('tag-table tbody tr').length > 0) {
      return;
    }
    await wait(50);
  }
  throw new Error('tags never rendered');
};

// The cell holds a copy-to-clipboard button as well as the tag, so read the
// tag element rather than the cell's text.
const tagsShown = (root) =>
  [...root.querySelectorAll('tag-table tbody .tag-col image-tag')].map((el) => el.textContent.trim()).sort();

describe('tag list navigation', function () {
  // Real HTTP against the mock, then polling for a render, so the 2s default is
  // not enough headroom.
  this.timeout(20000);

  let registry;
  let root;

  beforeEach(async () => {
    registry = await createMockRegistry({ port: 0 });
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await registry.close();
  });

  const mountHost = (image) => component(TagListHost)(root, { image, registryUrl: registry.url, tagsPerPage: '' });

  it('should render the tags of the repository it was mounted with', async () => {
    mountHost('nginx');
    await waitForTags(root);
    assert.deepEqual(tagsShown(root), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
  });

  // The router keeps one <tag-list> mounted and swaps the image prop, so a
  // component that only fetches on mount keeps serving the previous
  // repository's tags under the new repository's name -- next to a Delete
  // button.
  it('should refetch when the image prop changes', async () => {
    const host = mountHost('nginx');
    await waitForTags(root);
    assert.equal(tagsShown(root).length, 5, 'precondition: nginx has five tags');

    host.update({ image: 'oci-index' });
    for (let i = 0; i < 100 && tagsShown(root).length === 5; i++) {
      await wait(50);
    }
    assert.deepEqual(tagsShown(root), ['latest', 'v3'], 'the new repository’s tags should be shown');
  });

  it('should not leave a tag of the previous repository behind', async () => {
    const host = mountHost('nginx');
    await waitForTags(root);

    host.update({ image: 'oci-index' });
    for (let i = 0; i < 100 && tagsShown(root).includes('stable'); i++) {
      await wait(50);
    }
    assert.ok(!tagsShown(root).includes('stable'), 'a tag only nginx has must not survive the switch');
  });

  it('should ignore a superseded response that arrives after the current repository', async () => {
    await registry.close();
    registry = await createMockRegistry({
      port: 0,
      fixtures: fixtures.map((fixture) => (fixture.name === 'nginx' ? { ...fixture, delayMs: 300 } : fixture)),
    });
    const host = mountHost('nginx');
    host.update({ image: 'oci-index' });
    await waitForTags(root);
    assert.deepEqual(tagsShown(root), ['latest', 'v3']);
    await wait(400);
    assert.deepEqual(tagsShown(root), ['latest', 'v3'], 'the delayed nginx response must be ignored');
  });

  it('should show the empty state when switching to a repository with no tags', async () => {
    const host = mountHost('nginx');
    await waitForTags(root);

    host.update({ image: 'empty' });
    for (let i = 0; i < 100 && root.querySelectorAll('tag-table tbody tr').length > 0; i++) {
      await wait(50);
    }
    assert.equal(root.querySelectorAll('tag-table tbody tr').length, 0);
  });

  it('should search all tags before pagination', async () => {
    const host = component(TagListHost)(root, {
      image: 'exactly-100',
      registryUrl: registry.url,
      tagsPerPage: '10',
    });
    for (let i = 0; i < 100 && tagsShown(root).length !== 10; i++) {
      await wait(50);
    }
    host.update({ filter: 'tag-0099' });
    for (let i = 0; i < 100 && tagsShown(root)[0] !== 'tag-0099'; i++) {
      await wait(50);
    }
    assert.deepEqual(tagsShown(root), ['tag-0099']);
  });

  // Switching repositories must not restart the request loop on every render.
  it('should fetch once per repository, not once per render', async () => {
    const host = mountHost('nginx');
    await waitForTags(root);
    const before = registry.requestCount('/v2/oci-index/tags/list');

    host.update({ image: 'oci-index' });
    for (let i = 0; i < 100 && tagsShown(root).length !== 2; i++) {
      await wait(50);
    }
    for (let i = 0; i < 5; i++) {
      host.update();
      await wait(20);
    }

    const after = registry.requestCount('/v2/oci-index/tags/list');
    assert.equal(after - before, 1, `expected one tags/list request, got ${after - before}`);
  });
});
