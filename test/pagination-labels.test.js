/*
 * The first/previous/next/last buttons contain only an icon, and the numbered
 * ones were labelled "page-3" -- a slug rather than a phrase. Screen readers
 * need words, and a landmark so the group can be found.
 */
import assert from 'node:assert';
import { component } from 'riot';
import Pagination from '../src/components/tag-list/pagination.riot';

const mount = (pages) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(Pagination)(root, { pages, onPageUpdate: () => {} });
};

describe('pagination labels', () => {
  const pages = [
    { icon: 'first_page', page: 1 },
    { icon: 'chevron_left', page: 1 },
    { page: 1 },
    { page: 2, current: true },
    { icon: 'chevron_right', page: 3 },
    { icon: 'last_page', page: 5 },
  ];

  it('should name every button in words', () => {
    const labels = mount(pages)
      .$$('button')
      .map((b) => b.getAttribute('aria-label'));
    assert.deepEqual(labels, ['First page', 'Previous page', 'Page 1', 'Page 2', 'Next page', 'Last page']);
  });

  it('should be a labelled navigation landmark', () => {
    const nav = mount(pages).$('nav');
    assert.equal(nav.getAttribute('aria-label'), 'Pagination');
  });
});
