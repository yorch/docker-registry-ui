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

import assert from 'node:assert';
import { chromium } from 'playwright';
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
    // A page size of two so the catalogue actually paginates against the mock
    // registry, which holds far fewer repositories than any realistic limit.
    // This applies to the whole suite on purpose: startDevServer binds port 8000
    // and refuses to run alongside another instance, so isolating the pagination
    // test would cost a second full rollup build. Every other test here reaches
    // its tag list by route and never reads the catalogue.
    server = await startDevServer({ CATALOG_ELEMENTS_LIMIT: '2' });
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

  it('should show a real size and date for an index wrapping one platform', async () => {
    // What buildx produces for a single-platform build. Reporting "Multiple"
    // here contradicted the single architecture badge in the same row.
    await openTagList('single-platform-index');
    await page.waitForFunction(
      () => {
        const size = document.querySelector('tag-table tbody .image-size');
        return size && !['', '…'].includes(size.textContent.trim());
      },
      { timeout: 60000 },
    );

    const [size] = await cellsOn(page, 'tag-table tbody .image-size');
    const [date] = await cellsOn(page, 'tag-table tbody .image-date');
    assert.notEqual(size, 'Multiple', 'one platform has exactly one size');
    assert.match(size, /\d/, `expected a real size, got "${size}"`);
    assert.notEqual(date, 'Multiple', 'one platform has exactly one creation date');

    const arch = await page.$$eval('tag-table tbody td.architectures .architecture', (els) =>
      els.map((e) => e.textContent.trim()),
    );
    assert.deepEqual(arch, ['amd64']);
  });

  it('should truncate every content digest to the same width', async () => {
    // A row that subscribed before the first width broadcast used to render the
    // whole digest, ending up wider than its neighbours and clipped mid-hash.
    await openTagList('oci-index');
    await page.waitForFunction(
      () => {
        const cells = [...document.querySelectorAll('tag-table tbody image-content-digest div')];
        return cells.length > 1 && cells.every((cell) => cell.textContent.trim() !== '');
      },
      { timeout: 60000 },
    );
    const lengths = await page.$$eval('tag-table tbody image-content-digest div', (els) =>
      els.map((e) => e.textContent.trim().length),
    );
    assert.equal(new Set(lengths).size, 1, `digests rendered at differing widths: ${lengths.join(', ')}`);
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

  it('should inspect every platform without presenting the first one as the whole index', async () => {
    await openTagList('oci-index');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('tag-table tbody .image-size')].every(
          (cell) => cell.textContent.trim() === 'Multiple',
        ),
      { timeout: 60000 },
    );
    await page
      .locator('tag-table tbody tr')
      .first()
      .getByRole('button', { name: /inspect/i })
      .click();
    await page.waitForFunction(() => document.querySelectorAll('image-details .platform-card').length === 3, {
      timeout: 60000,
    });

    const platforms = await cellsOn(page, 'image-details .platform-card strong');
    assert.deepEqual(platforms, ['linux/amd64', 'linux/arm64/v8', 'linux/ppc64le']);
    assert.match(await page.textContent('image-details .details-note'), /Shared layers are counted once/);
  });

  it('should follow catalog continuation links on demand', async () => {
    await page.goto(server.url, { waitUntil: 'load' });
    await page.waitForSelector('catalog .catalog-pagination');
    assert.match(await page.textContent('catalog .catalog-pagination'), /2 repositories loaded/);

    await page.getByRole('button', { name: 'Load More' }).click();
    await page.waitForFunction(() =>
      /4 repositories loaded/.test(document.querySelector('catalog .catalog-pagination')?.textContent),
    );
    assert.match(await page.textContent('catalog .catalog-stats'), /4 repositories/);
  });

  it('should name the registry in the topbar, not in the catalog panel', async () => {
    await page.goto(server.url, { waitUntil: 'load' });
    await page.waitForSelector('catalog .catalog-header');

    // REGISTRY_TITLE, which the dev server sets to "Development Registry".
    // The topbar used to show the bare host and ignore the configured name.
    assert.match(await page.textContent('.topbar registry-menu .registry-label'), /Development Registry/);
    assert.equal(
      await page.getAttribute('.topbar registry-menu .registry-trigger', 'title'),
      'http://localhost:5555',
      'the URL stays reachable in the tooltip',
    );

    // And the panel no longer repeats it as "Repositories of <title>".
    const heading = await page.textContent('catalog .panel-title');
    assert.equal(heading.trim(), 'Repositories');
    assert.doesNotMatch(heading, /\bof\b/);
  });

  it('should count repositories and namespaces as different things', async () => {
    await page.goto(server.url, { waitUntil: 'load' });
    await page.waitForSelector('catalog .catalog-pagination');
    await page.getByRole('button', { name: 'Load All' }).click();
    await page.waitForFunction(() => !document.querySelector('catalog .catalog-pagination'));

    const stats = await page.textContent('catalog .catalog-stats');
    const repositories = Number(stats.match(/(\d+) repositories/)[1]);
    const namespaces = Number(stats.match(/(\d+) namespaces/)[1]);

    // `team/service-a` and `team/service-b` are two repositories under one
    // namespace, so these two counts must not agree. Reporting the same number
    // twice is exactly the bug the renamed labels are meant to make obvious.
    assert.ok(repositories > namespaces, `expected fewer namespaces than repositories, got "${stats.trim()}"`);
    assert.equal(repositories - namespaces, 1, 'only the two team/* repositories collapse into one namespace');

    // "Namespace" is this UI's own term -- the registry has no such concept --
    // so each badge has to explain itself in place.
    const titles = await page.$$eval('catalog .catalog-stats .badge', (els) => els.map((e) => e.title));
    assert.match(titles[0], /pull/i);
    assert.match(titles[1], /grouped|grouping/i);
  });

  it('should show the commit the bundle was built from, linked to its source', async () => {
    // The dev server builds from this checkout, so rollup's git fallback fills
    // the hash in -- the same field the image workflows supply via COMMIT_HASH.
    await page.goto(server.url, { waitUntil: 'load' });
    const link = page.locator('.app-footer .app-footer-commit');
    await link.waitFor();

    const short = (await link.textContent()).trim();
    assert.match(short, /^[0-9a-f]{7}$/, 'the footer should show a seven-character short hash');

    const href = await link.getAttribute('href');
    assert.match(href, /^https:\/\/github\.com\/yorch\/docker-registry-ui\/commit\/[0-9a-f]{7,40}$/);
    assert.ok(href.includes(`/commit/${short}`), 'the link should point at the commit it displays');
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
