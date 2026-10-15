/*
 * The "Add registry" button lives in the registry menu's popover, which closes
 * the moment the dialog opens. Focus therefore cannot go back to the button it
 * came from; it has to land on the menu trigger, which is still on the page.
 */
import assert from 'node:assert';
import { component, register, unregister } from 'riot';
import AppDialog from '../src/components/app-dialog.riot';
import RegistryMenu from '../src/components/dialogs/registry-menu.riot';
import TextField from '../src/components/text-field.riot';

describe('add registry dialog focus', () => {
  let menu;

  before(() => {
    register('app-dialog', AppDialog);
    register('text-field', TextField);
  });
  after(() => {
    unregister('app-dialog');
    unregister('text-field');
  });

  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.appendChild(root);
    menu = component(RegistryMenu)(root, { registryUrl: 'https://registry.example.com', onNotify() {} });
    const trigger = menu.$('.registry-trigger');
    trigger.focus();
    trigger.click();
    const add = [...menu.root.querySelectorAll('.popover-actions .btn')].find((b) =>
      /Add registry/.test(b.textContent),
    );
    add.focus();
    add.click();
  });
  afterEach(() => {
    menu.unmount();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('should open the dialog and close the popover', () => {
    assert.ok(menu.$('[role=dialog]'));
    assert.equal(menu.$('.registry-popover'), null);
  });

  it('should return focus to the registry trigger when the dialog is closed with Cancel', () => {
    [...menu.root.querySelectorAll('[role=dialog] .btn')].find((b) => b.textContent.trim() === 'Cancel').click();
    assert.equal(menu.$('[role=dialog]'), null);
    assert.equal(document.activeElement, menu.$('.registry-trigger'));
  });

  it('should return focus to the registry trigger when the dialog is closed with Escape', () => {
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.equal(menu.$('[role=dialog]'), null);
    assert.equal(document.activeElement, menu.$('.registry-trigger'));
  });
});
