import { component } from 'riot';
import AppCheckbox from '../src/components/app-checkbox.riot';
import assert from 'assert';

const mountCheckbox = (props = {}) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const events = [];
  const instance = component(AppCheckbox)(root, {
    onChange: (event) => events.push(event),
    ...props,
  });
  return { root, events, instance, input: root.querySelector('input') };
};

const clickWith = (input, init = {}) =>
  input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

describe('app-checkbox', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // Alt+Click select-all and Shift+Click range selection read these off the
  // event. They only exist on MouseEvent, so forwarding a `change` event --
  // which is a plain Event -- silently disables both features.
  it('should forward altKey from the originating mouse event', () => {
    const { events, input } = mountCheckbox();
    clickWith(input, { altKey: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].altKey, true);
  });

  it('should forward shiftKey from the originating mouse event', () => {
    const { events, input } = mountCheckbox();
    clickWith(input, { shiftKey: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].shiftKey, true);
  });

  it('should report no modifiers for a plain click', () => {
    const { events, input } = mountCheckbox();
    clickWith(input);
    assert.equal(events[0].altKey, false);
    assert.equal(events[0].shiftKey, false);
  });

  // Consumers read event.target.checked, so the event has to carry the state
  // the checkbox ends up in, not the one it started from.
  it('should expose the post-click checked state on the event target', () => {
    const { events, input } = mountCheckbox({ checked: false });
    clickWith(input);
    assert.equal(events[0].target.checked, true);
    clickWith(input);
    assert.equal(events[1].target.checked, false);
  });

  // The input sits inside a <label>, and consumers wrap that in another label.
  // A click that got forwarded twice would toggle back to where it started.
  it('should notify exactly once per click', () => {
    const { events, input } = mountCheckbox();
    clickWith(input);
    assert.equal(events.length, 1);
  });

  // remove-image disables the checkbox for tags whose content digest could not
  // be read, so they cannot be selected for deletion. Driven through click(),
  // which is specified to do nothing on a disabled form control -- an explicit
  // dispatchEvent would run the listener regardless and prove nothing.
  it('should not notify when disabled', () => {
    const { events, input } = mountCheckbox({ disabled: true });
    input.click();
    assert.equal(events.length, 0);
  });

  it('should notify when enabled and clicked the same way', () => {
    const { events, input } = mountCheckbox({ disabled: false });
    input.click();
    assert.equal(events.length, 1);
  });
});
