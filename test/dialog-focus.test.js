/*
 * A modal dialog has to behave like one for keyboard and screen-reader users:
 * Escape closes it, focus moves in when it opens, Tab cannot leave it, and
 * focus goes back to what opened it. All dialogs render through <app-dialog>.
 */
import assert from 'node:assert';
import { component } from 'riot';
import DialogHost from './fixtures/dialog-host.riot';

const key = (target, k, opts = {}) => {
  const event = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(event);
  return event;
};

describe('dialog focus management', () => {
  let host;
  let opener;

  const open = () => {
    opener.focus();
    opener.click();
  };

  beforeEach(() => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.appendChild(root);
    host = component(DialogHost)(root, {});
    opener = host.$('.opener');
  });

  afterEach(() => {
    host.unmount();
  });

  it('should not render the dialog until opened', () => {
    assert.equal(host.$('[role=dialog]'), null);
  });

  it('should move focus to the first focusable element in the body on open', () => {
    open();
    assert.equal(document.activeElement, host.$('.first'));
  });

  it('should close on Escape', () => {
    open();
    key(document.activeElement, 'Escape');
    assert.equal(host.$('[role=dialog]'), null);
  });

  it('should return focus to the opener on close', () => {
    open();
    key(document.activeElement, 'Escape');
    assert.equal(document.activeElement, opener);
  });

  it('should return focus to the opener when closed with the close button', () => {
    open();
    host.$('[aria-label="Close dialog"]').click();
    assert.equal(document.activeElement, opener);
  });

  it('should wrap Tab from the last focusable element to the first', () => {
    open();
    host.$('.last').focus();
    const event = key(host.$('.last'), 'Tab');
    assert.ok(event.defaultPrevented);
    assert.equal(document.activeElement, host.$('[aria-label="Close dialog"]'));
  });

  it('should wrap Shift+Tab from the first focusable element to the last', () => {
    open();
    host.$('[aria-label="Close dialog"]').focus();
    const event = key(document.activeElement, 'Tab', { shiftKey: true });
    assert.ok(event.defaultPrevented);
    assert.equal(document.activeElement, host.$('.last'));
  });

  it('should pull focus back in when it is outside the dialog', () => {
    open();
    host.$('.elsewhere').focus();
    key(document.activeElement, 'Tab');
    assert.ok(host.$('[role=dialog]').contains(document.activeElement));
  });

  it('should not intercept Escape or Tab when no dialog is open', () => {
    const escape = key(opener, 'Escape');
    const tab = key(opener, 'Tab');
    assert.equal(escape.defaultPrevented, false);
    assert.equal(tab.defaultPrevented, false);
  });

  it('should stop listening after it closes', () => {
    open();
    key(document.activeElement, 'Escape');
    const tab = key(opener, 'Tab');
    assert.equal(tab.defaultPrevented, false);
  });
});
