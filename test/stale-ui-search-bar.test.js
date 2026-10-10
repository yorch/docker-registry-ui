import assert from 'node:assert';
import { component } from 'riot';
import SearchHost from './fixtures/stale-ui-search-host.riot';

describe('search bar stale UI', () => {
  afterEach(() => document.body.replaceChildren());

  // H9: the reset cleared the input, then called update() from onUpdated,
  // which Riot does not patch, so the clear button for the old text stayed.
  it('should clear the input and the clear button when the reset token changes', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host = component(SearchHost)(root, {});
    const input = root.querySelector('input');
    input.value = 'nginx';
    input.dispatchEvent(new Event('keyup'));
    assert.ok(root.querySelector('button[aria-label="Clear search"]'), 'precondition: text shows the clear button');

    host.update({ token: 1 });
    assert.equal(input.value, '');
    assert.equal(root.querySelector('button[aria-label="Clear search"]'), null);
  });
});

// The first keystroke must not be mistaken for a reset: the bar has not
// re-rendered since mount, so the token it remembers must already be the prop's.
describe('search bar first keystroke', () => {
  afterEach(() => document.body.replaceChildren());

  it('should keep the typed text when no re-render happened since mount', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    component(SearchHost)(root, {});
    const input = root.querySelector('input');
    input.value = 'n';
    input.dispatchEvent(new Event('keyup'));
    assert.equal(input.value, 'n', 'typed text was wiped by the reset-token check');
  });
});
