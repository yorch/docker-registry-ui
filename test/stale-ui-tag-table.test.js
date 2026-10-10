import assert from 'node:assert';
import observable from '@riotjs/observable';
import { component, register, unregister } from 'riot';
import AppCheckbox from '../src/components/app-checkbox.riot';
import TableHost from './fixtures/stale-ui-table-host.riot';

// A tag whose content digest is known to the table is selectable; one without is not.
const image = (tag, { digest = true } = {}) => {
  const img = observable({ name: 'repo', tag, size: 100, creationDate: new Date(0) });
  img.on('get-content-digest', () => {
    if (digest) {
      img.contentDigest = `sha256:${tag}`;
      img.trigger('content-digest', img.contentDigest);
    }
  });
  return img;
};

const mount = (props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { root, host: component(TableHost)(root, props) };
};

const rowTags = (root) => [...root.querySelectorAll('tbody tr image-tag')].map((el) => el.textContent.trim());
const rowCheckboxes = (root) => [...root.querySelectorAll('tbody tr remove-image input[type="checkbox"]')];
const headerCheckbox = (root) => root.querySelector('thead input[type="checkbox"]');
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('tag table stale UI', () => {
  // The app registers its shared components globally; the table expects them.
  before(() => register('app-checkbox', AppCheckbox));
  after(() => unregister('app-checkbox'));
  afterEach(() => document.body.replaceChildren());

  // H8: rows were matched by index, so the remove-image checkbox of the new
  // second row kept the digest of the tag that used to sit there and was
  // enabled for a tag whose digest is not known.
  it('should not carry a row’s state to a different tag when the list grows in the middle', () => {
    const a = image('a');
    const b = image('b', { digest: false });
    const c = image('c');
    const { root, host } = mount({ tags: [a, c] });
    click(headerCheckbox(root));
    assert.deepEqual(rowTags(root), ['a', 'c']);

    host.update({ tags: [a, b, c] });
    // A different tag list also ends multi-delete mode (see the selection tests below).
    click(headerCheckbox(root));
    assert.deepEqual(rowTags(root), ['a', 'b', 'c']);
    assert.deepEqual(
      rowCheckboxes(root).map((input) => input.disabled),
      [false, true, false],
      'only b, which has no digest, should be disabled',
    );
  });

  it('should show the right tags and states after paging', () => {
    const tags = [image('t1'), image('t2'), image('t3', { digest: false }), image('t4')];
    const { root, host } = mount({ tags, tagsPerPage: '2' });
    click(headerCheckbox(root));
    assert.deepEqual(rowTags(root), ['t1', 't2']);

    host.update({ page: 2 });
    assert.deepEqual(rowTags(root), ['t3', 't4']);
    assert.deepEqual(
      rowCheckboxes(root).map((input) => input.disabled),
      [true, false],
    );
  });

  // H10: the selection was only cleared when the page changed, so a refresh or
  // navigation left Delete pointing at tags that were no longer shown.
  it('should drop the selection when the tags are replaced', () => {
    const { root, host } = mount({ tags: [image('a'), image('b')] });
    click(headerCheckbox(root));
    click(rowCheckboxes(root)[0]);
    assert.ok(root.querySelector('.selection-bar'), 'precondition: a row is selected');

    host.update({ tags: [image('a'), image('b')] });
    assert.equal(root.querySelector('.selection-bar'), null, 'the selection bar must be gone');
    assert.ok(
      rowCheckboxes(root).every((input) => !input.checked),
      'no row may stay checked',
    );
  });

  it('should keep the selection while the same tags are re-rendered', () => {
    const tags = [image('a'), image('b')];
    const { root, host } = mount({ tags });
    click(headerCheckbox(root));
    click(rowCheckboxes(root)[0]);
    host.update({ tags: [...tags] });
    assert.ok(root.querySelector('.selection-bar'), 'an unrelated re-render must not clear the selection');
  });
});
