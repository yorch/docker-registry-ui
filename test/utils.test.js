import { isNewestVersion, getNumPages, getPage } from '../src/scripts/utils.js';
import assert from 'assert';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe('utils tests', () => {
  describe('isNewestVersion', () => {
    it(`should return true for the same version`, () => {
      const expected = ['2.0.0', '2.4.1', '2.5.0', null, undefined];
      expected.forEach((e) => assert.ok(isNewestVersion(e, e)));
    });

    it(`should return true with on common versions`, () => {
      assert.ok(isNewestVersion('2.5.1', '2.5.0'));
      assert.ok(isNewestVersion('2.5.0', '2.0.0'));
      assert.ok(isNewestVersion('2.15.0', '1.25.10'));
      assert.ok(isNewestVersion('10.10.10', '2.25.20'));
    });

    it(`should return false on common versions`, () => {
      assert.equal(isNewestVersion('1.0.0', '2.5.0'), false);
      assert.equal(isNewestVersion('10.10.10', '20.20.20'), false);
      assert.equal(isNewestVersion('2.4.10', '2.5.0'), false);
      assert.equal(isNewestVersion('2.5.0', '2.6.0'), false);
    });

    it(`should return true for -dev next versions`, () => {
      assert.ok(isNewestVersion('2.5.0-dev', '2.4.1'));
      assert.ok(isNewestVersion('2.6.0-dev', '2.5.0'));
      assert.ok(isNewestVersion('2.15.0-dev', '2.14.1'));
      assert.ok(isNewestVersion('2.15.0-dev', '1.16.0'));
    });

    it(`should return false for -dev with current minor version`, () => {
      assert.equal(isNewestVersion('2.5.0-dev', '2.5.0'), false);
      assert.equal(isNewestVersion('2.5.0-dev', '2.5.10'), false);
      assert.equal(isNewestVersion('2.15.0-dev', '2.15.0'), false);
      assert.equal(isNewestVersion('2.0.0-dev', '2.15.0'), false);
    });
    it(`should return true for -{commit sha} next versions`, () => {
      assert.ok(isNewestVersion('2.5.0-ffb6d14baf', '2.4.1'));
      assert.ok(isNewestVersion('2.6.0-ffb6d14baf', '2.5.0'));
      assert.ok(isNewestVersion('2.15.0-ffb6d14baf', '2.14.1'));
      assert.ok(isNewestVersion('2.15.0-ffb6d14baf', '1.16.0'));
    });

    it(`should return false for -{commit sha} with current minor version`, () => {
      assert.equal(isNewestVersion('2.5.0-ffb6d14baf', '2.5.0'), false);
      assert.equal(isNewestVersion('2.5.0-ffb6d14baf', '2.5.10'), false);
      assert.equal(isNewestVersion('2.15.0-ffb6d14baf', '2.15.0'), false);
      assert.equal(isNewestVersion('2.0.0-ffb6d14baf', '2.15.0'), false);
    });
  });

  describe('getNumPages', () => {
    it(`should not add an empty trailing page when the count is an exact multiple of the limit`, () => {
      assert.equal(getNumPages(range(100), 100), 1);
      assert.equal(getNumPages(range(10), 10), 1);
      assert.equal(getNumPages(range(200), 100), 2);
      assert.equal(getNumPages(range(30), 10), 3);
    });

    it(`should round up for a partial last page`, () => {
      assert.equal(getNumPages(range(101), 100), 2);
      assert.equal(getNumPages(range(1), 100), 1);
      assert.equal(getNumPages(range(99), 100), 1);
      assert.equal(getNumPages(range(11), 10), 2);
    });

    it(`should return a single page for an empty list`, () => {
      assert.equal(getNumPages([], 100), 1);
      assert.equal(getNumPages([], 10), 1);
    });

    it(`should default to a limit of 100 when none is given`, () => {
      assert.equal(getNumPages(range(100)), 1);
      assert.equal(getNumPages(range(101)), 2);
    });

    it(`should return 0 when the list is missing`, () => {
      assert.equal(getNumPages(undefined, 100), 0);
      assert.equal(getNumPages(null, 100), 0);
    });
  });

  describe('getPage', () => {
    it(`should return every page reported by getNumPages non-empty`, () => {
      const elts = range(100);
      const nPages = getNumPages(elts, 10);
      for (let page = 1; page <= nPages; page++) {
        assert.ok(getPage(elts, page, 10).length > 0, `page ${page} of ${nPages} should not be empty`);
      }
    });

    it(`should slice the requested page`, () => {
      const elts = range(30);
      assert.deepEqual(getPage(elts, 1, 10), range(10));
      assert.deepEqual(getPage(elts, 3, 10), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    });
  });
});
