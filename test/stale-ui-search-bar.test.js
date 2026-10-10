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
    // The app shell re-renders the bar before anyone types; that is what records the current token.
    host.update();
    const input = root.querySelector('input');
    input.value = 'nginx';
    input.dispatchEvent(new Event('keyup'));
    assert.ok(root.querySelector('button[aria-label="Clear search"]'), 'precondition: text shows the clear button');

    host.update({ token: 1 });
    assert.equal(input.value, '');
    assert.equal(root.querySelector('button[aria-label="Clear search"]'), null);
  });
});
