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
    host.update({ tags: [...tags], allTags: tags });
    assert.ok(root.querySelector('.selection-bar'), 'an unrelated re-render must not clear the selection');
  });

  // The parent passes the filtered list as `tags` and the fetched list as
  // `allTags`; typing in the search box changes only the former.
  it('should keep the selection when the search narrows the visible tags', () => {
    const a = image('a');
    const ab = image('ab');
    const b = image('b');
    const all = [a, ab, b];
    const { root, host } = mount({ tags: all });
    click(headerCheckbox(root));
    click(rowCheckboxes(root)[0]);
    assert.ok(root.querySelector('.selection-bar'), 'precondition: a row is selected');

    host.update({ tags: [a, ab], allTags: all });
    assert.ok(root.querySelector('.selection-bar'), 'typing in the search must not clear the selection');
    assert.ok(rowCheckboxes(root)[0].checked, 'the selected row must stay checked');
  });

  // R7: a refresh replaces every DockerImage but keeps the tag names, and the
  // rows used to be keyed by name, so they stayed bound to the old objects.
  it('should rebind a row to the new image object when a tag is replaced', () => {
    const { root, host } = mount({ tags: [image('a')] });
    assert.equal(root.querySelector('tbody remove-image button').disabled, false);
    host.update({ tags: [image('a', { digest: false })] });
    assert.equal(
      root.querySelector('tbody remove-image button').disabled,
      true,
      'the Delete button still reflects the previous object’s digest',
    );
  });

  it('should keep rows attached to their images when the order is reversed', () => {
    const a = image('a');
    const b = image('b', { digest: false });
    // Reversing happens in place in the parent: same array, new order.
    const all = [a, b];
    const { root, host } = mount({ tags: all });
    click(headerCheckbox(root));
    all.reverse();
    host.update();
    assert.deepEqual(rowTags(root), ['b', 'a']);
    assert.deepEqual(
      rowCheckboxes(root).map((input) => input.disabled),
      [true, false],
    );
  });
});
