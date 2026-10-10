/*
 * ARIA roles are promises about keyboard behaviour. role=menu and role=tab
 * imply menuitems, arrow keys and (for tabs) tabpanels; the registry menu and
 * the architecture tabs have none of that, so they must not claim it.
 */
import assert from 'node:assert';
import { component } from 'riot';
import AppTabs from '../src/components/app-tabs.riot';
import RegistryMenu from '../src/components/dialogs/registry-menu.riot';

const mount = (Component, props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(Component)(root, props);
};

describe('registry menu', () => {
  const menu = () => mount(RegistryMenu, { registryUrl: 'https://registry.example.com', onNotify: () => {} });

  it('should not claim the ARIA menu pattern', () => {
    const m = menu();
    m.$('.registry-trigger').click();
    assert.equal(m.$('[role=menu]'), null);
    assert.equal(m.$('.registry-trigger').getAttribute('aria-haspopup'), null);
  });

  it('should expose open state and the controlled popover', () => {
    const m = menu();
    const trigger = m.$('.registry-trigger');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    trigger.click();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(m.$(`#${trigger.getAttribute('aria-controls')}`), m.$('.registry-popover'));
  });

  it('should close on Escape and return focus to the trigger', () => {
    const m = menu();
    m.$('.registry-trigger').click();
    m.$('.popover-item')?.focus();
    m.$('.registry-menu').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(m.$('.registry-popover'), null);
    assert.equal(document.activeElement, m.$('.registry-trigger'));
  });
});

describe('tabs', () => {
  it('should be a labelled group of toggle buttons, not a tablist', () => {
    const tabs = mount(AppTabs, { tabs: ['amd64', 'arm64'], ariaLabel: 'Architectures' });
    assert.equal(tabs.$('[role=tablist]'), null);
    assert.equal(tabs.$('[role=tab]'), null);
    assert.equal(tabs.$('[role=group]').getAttribute('aria-label'), 'Architectures');
    assert.deepEqual(
      tabs.$$('button').map((b) => b.getAttribute('aria-pressed')),
      ['true', 'false'],
    );
  });

  it('should move aria-pressed with the selection', () => {
    const tabs = mount(AppTabs, { tabs: ['amd64', 'arm64'] });
    tabs.$$('button')[1].click();
    assert.deepEqual(
      tabs.$$('button').map((b) => b.getAttribute('aria-pressed')),
      ['false', 'true'],
    );
  });
});
