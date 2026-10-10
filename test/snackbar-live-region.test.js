/*
 * A live region that appears together with its text is often not announced, and
 * an error that vanishes after four seconds cannot be read, let alone acted on.
 */
import assert from 'node:assert';
import { component } from 'riot';
import AppSnackbar from '../src/components/app-snackbar.riot';

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let timers;

const mount = (props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(AppSnackbar)(root, props);
};
const pending = () => [...timers.values()].filter((t) => t.delay === 4000);
const fire = (el, type) =>
  el.dispatchEvent(new window.Event(type, { bubbles: type === 'focusin' || type === 'focusout' }));

describe('snackbar live region', () => {
  beforeEach(() => {
    timers = new Map();
    let id = 0;
    globalThis.setTimeout = (fn, delay) => {
      timers.set(++id, { fn, delay });
      return id;
    };
    globalThis.clearTimeout = (t) => timers.delete(t);
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  it('should have the polite and assertive regions in the DOM before any message', () => {
    const s = mount({});
    assert.ok(s.$('[role=status][aria-live=polite]'));
    assert.ok(s.$('[role=alert][aria-live=assertive]'));
    assert.equal(s.$('.snackbar'), null);
  });

  it('should render a message inside the status region', () => {
    const s = mount({ message: 'Copied' });
    assert.ok(s.$('[role=status] .snackbar'));
    assert.equal(s.$('[role=alert] .snackbar'), null);
  });

  it('should render an error inside the alert region', () => {
    const s = mount({ message: 'Boom', isError: true });
    assert.ok(s.$('[role=alert] .snackbar.is-error'));
  });

  it('should auto-dismiss a plain message', () => {
    const calls = [];
    mount({ message: 'Copied', onDismiss: () => calls.push(1) });
    assert.equal(pending().length, 1);
    pending()[0].fn();
    assert.equal(calls.length, 1);
  });

  it('should not auto-dismiss an error', () => {
    mount({ message: 'Boom', isError: true });
    assert.equal(pending().length, 0);
  });

  it('should hold a message while the pointer is on it and resume after', () => {
    const s = mount({ message: 'Copied' });
    fire(s.$('.snackbar'), 'mouseenter');
    assert.equal(pending().length, 0);
    fire(s.$('.snackbar'), 'mouseleave');
    assert.equal(pending().length, 1);
  });

  it('should hold a message while focus is inside it', () => {
    const s = mount({ message: 'Copied' });
    fire(s.$('.snackbar-close'), 'focusin');
    assert.equal(pending().length, 0);
    fire(s.$('.snackbar-close'), 'focusout');
    assert.equal(pending().length, 1);
  });
});
