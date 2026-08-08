/*
 * End-to-end coverage in a real browser.
 *
 * These exist because every bug in this list shipped past a green unit suite:
 * a cached tag list rendering an empty table, a component that kept the
 * previous repository's tags, cells that claimed to be loading forever. They
 * all needed a real document, a real cache and real requests to show up.
 *
 * Kept deliberately small: a handful of assertions about what the page shows,
 * not a second copy of the unit suite.
 */

import { chromium } from 'playwright';
import assert from 'node:assert';
import { startDevServer } from './dev-server.js';

const tagsOn = (page) =>
  page.$$eval('tag-table tbody .tag-col image-tag', (els) => els.map((e) => e.textContent.trim()).sort());

const cellsOn = (page, selector) => page.$$eval(selector, (els) => els.map((e) => e.textContent.trim()));

describe('tag list in a browser', function () {
  this.timeout(180000);

  let server;
  let browser;
  let page;

  before(async () => {
    server = await startDevServer();
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    page.on('pageerror', (error) => {
      // A stack overflow from a re-render loop surfaces here and nowhere else.
      throw new Error(`uncaught page error: ${error.message}`);
    });
  });

  afterEach(async () => {
    await page?.close();
  });

  const openTagList = async (repository) => {
    await page.goto(`${server.url}#!/taglist/${repository}`, { waitUntil: 'load' });
    await page.waitForSelector('tag-table tbody tr', { timeout: 60000 });
  };

  it('should list a repository’s tags', async () => {
    await openTagList('nginx');
    assert.deepEqual(await tagsOn(page), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
  });

  // Every cell used to resolve from a request; once the responses are cached a
  // second visit takes a different path through Http, which is where a tag
  // table once rendered completely empty with nothing logged.
  it('should still render every row when the responses come from cache', async () => {
    await openTagList('nginx');
    await page.waitForFunction(
      () => [...document.querySelectorAll('tag-table tbody .image-size')].every((e) => /\d/.test(e.textContent)),
      { timeout: 60000 },
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('tag-table tbody tr', { timeout: 60000 });

    assert.deepEqual(await tagsOn(page), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
    const sizes = await cellsOn(page, 'tag-table tbody .image-size');
    assert.ok(
      sizes.every((s) => /\d/.test(s)),
      `every size should still render from cache, got ${JSON.stringify(sizes)}`,
    );
  });

  // Both URLs match the same route, so the component is updated rather than
  // remounted -- it used to keep showing the previous repository's tags under
  // the new repository's name, beside a delete control.
  it('should replace the tags when navigating to another repository', async () => {
    await openTagList('nginx');
    await page.evaluate(() => {
      location.hash = '#!/taglist/oci-index';
    });
    await page.waitForFunction(() => document.querySelectorAll('tag-table tbody tr').length === 2, { timeout: 60000 });

    assert.deepEqual(await tagsOn(page), ['latest', 'v3']);
    assert.match(await page.textContent('tag-list .panel-title'), /oci-index/);
  });

  it('should restore the first repository’s tags on going back', async () => {
    await openTagList('nginx');
    await page.evaluate(() => {
      location.hash = '#!/taglist/oci-index';
    });
    await page.waitForFunction(() => document.querySelectorAll('tag-table tbody tr').length === 2, { timeout: 60000 });

    await page.goBack();
    await page.waitForFunction(() => document.querySelectorAll('tag-table tbody tr').length === 5, { timeout: 60000 });
    assert.deepEqual(await tagsOn(page), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
  });

  // The fixture repository whose manifests 404. Cells must say the value could
  // not be fetched rather than claim to still be loading.
  it('should mark cells unavailable when the manifest cannot be fetched', async () => {
    await openTagList('broken-manifest');
    await page.waitForFunction(
      () => [...document.querySelectorAll('tag-table tbody .image-size')].every((e) => e.textContent.trim() === '—'),
      { timeout: 60000 },
    );

    assert.deepEqual(await cellsOn(page, 'tag-table tbody .image-size'), ['—', '—', '—']);
    assert.deepEqual(await cellsOn(page, 'tag-table tbody td.creation-date'), ['—', '—', '—']);
  });

  it('should resolve every architecture of a multi-architecture index', async () => {
    await openTagList('oci-index');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('tag-table tbody td.architectures')].every((e) => /amd64/.test(e.textContent)),
      { timeout: 60000 },
    );
    // Each architecture is its own element with no separator between them, so
    // read them individually rather than flattening the cell's text.
    const arch = await page.$$eval('tag-table tbody td.architectures', (cells) =>
      cells.map((cell) => [...cell.querySelectorAll('.architecture')].map((e) => e.textContent.trim())),
    );
    assert.ok(arch.length > 0, 'the index should render at least one row');
    arch.forEach((platforms) => assert.deepEqual(platforms, ['amd64', 'arm64v8', 'ppc64le']));
  });

  it('should page a large repository without an empty trailing page', async () => {
    await openTagList('exactly-100');
    const rows = await page.$$eval('tag-table tbody tr', (els) => els.length);
    assert.equal(rows, 100);
    // 100 tags at the default page size is exactly one page, so there should be
    // no pagination controls at all.
    assert.equal(await page.$$eval('pagination button, pagination a', (els) => els.length), 0);
  });

  it('should bypass cached tag data when the user refreshes', async () => {
    await openTagList('nginx');
    const refetch = page.waitForRequest((request) => request.url().endsWith('/v2/nginx/tags/list'));
    await page.getByRole('button', { name: 'Refresh tags' }).click();
    await refetch;
    await page.waitForFunction(() => !document.querySelector('tag-list .refresh-status'));
    assert.deepEqual(await tagsOn(page), ['1.26', '1.27', '1.27.3', 'latest', 'stable']);
  });

  it('should wait for deletion to finish before refreshing the list', async () => {
    await openTagList('nginx');
    const deleteButton = page.locator('remove-image button').first();
    await page.waitForFunction(() => {
      const button = document.querySelector('remove-image button');
      return button && !button.disabled;
    });
    await deleteButton.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('tag-list .empty-state h3')?.textContent.trim() === 'No tags',
    );
    assert.equal((await tagsOn(page)).length, 0);
  });
});
