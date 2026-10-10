import assert from 'node:assert';
import { router as routeStream } from '@riotjs/route';
import router from '../src/scripts/router.js';

const go = async (path) => {
  routeStream.push(path);
  await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('router route parsing', () => {
  it('should read an image whose name contains "taglist/"', async () => {
    await go('http://localhost/#!/taglist/team/taglist/service');
    assert.equal(router.getTagListImage(), 'team/taglist/service');
  });

  it('should read an image whose name contains "taghistory/image/"', async () => {
    await go('http://localhost/#!/taghistory/image/team/taghistory/image/x/tag/latest');
    assert.equal(router.getTagHistoryImage(), 'team/taghistory/image/x');
    assert.equal(router.getTagHistoryTag(), 'latest');
  });

  it('should not put a trailing slash in the tag', async () => {
    await go('http://localhost/#!/taghistory/image/team/a/tag/latest/');
    assert.equal(router.getTagHistoryTag(), 'latest');
    assert.equal(router.getTagHistoryImage(), 'team/a');
  });

  it('should split an image on the last /tag/', async () => {
    await go('http://localhost/#!/taghistory/image/team/tag/a/tag/v1');
    assert.equal(router.getTagHistoryImage(), 'team/tag/a');
    assert.equal(router.getTagHistoryTag(), 'v1');
  });
});

describe('router query string', () => {
  afterEach(() => window.history.pushState(null, '', '/'));

  it('should not cut the name of a parameter that has no value', () => {
    window.history.pushState(null, '', '/?debug&page=2');
    assert.equal(router.getPageQueryParam(), '2');
    router.updateQueryString({ page: '3' });
    assert.equal(window.location.search, '?debug=&page=3');
  });
});
