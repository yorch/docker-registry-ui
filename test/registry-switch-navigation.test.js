/*
 * Switching or adding a registry from the tag list or tag history used to leave
 * the hash route in place: router.home() only returns a URL string, so calling
 * it for its side effect did nothing and the old registry's image stayed open.
 */
import assert from 'node:assert';
import { component, register, unregister } from 'riot';
import AppDialog from '../src/components/app-dialog.riot';
import AddRegistryUrl from '../src/components/dialogs/add-registry-url.riot';
import RegistryMenu from '../src/components/dialogs/registry-menu.riot';
import TextField from '../src/components/text-field.riot';

const mount = (Component, props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(Component)(root, props);
};

const openTagList = () => window.history.pushState(null, '', '/?url=abc#!/taglist/team/service-a');

describe('registry switch navigation', () => {
  // The dialog's children are registered globally by src/index.js in the app.
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
    window.history.pushState(null, '', '/');
  });
  afterEach(() => {
    document.body.replaceChildren();
    window.history.pushState(null, '', '/');
  });

  it('should leave the tag list when another registry is picked', () => {
    localStorage.setItem('registryServer', JSON.stringify(['https://one.example.com', 'https://two.example.com']));
    const changed = [];
    const menu = mount(RegistryMenu, {
      registryUrl: 'https://one.example.com',
      onServerChange: (url) => changed.push(url),
      onNotify: () => {},
    });
    openTagList();
    menu.switchRegistry('https://two.example.com');
    assert.equal(window.location.hash, '', 'the tag list route must be left');
    assert.deepEqual(changed, ['https://two.example.com']);
  });

  it('should leave the tag list when the active registry is removed', () => {
    localStorage.setItem('registryServer', JSON.stringify(['https://one.example.com', 'https://two.example.com']));
    const menu = mount(RegistryMenu, {
      registryUrl: 'https://one.example.com',
      onServerChange: () => {},
      onNotify: () => {},
    });
    openTagList();
    menu.removeRegistry('https://one.example.com');
    assert.equal(window.location.hash, '');
  });

  it('should leave the tag history when a registry is added', () => {
    const changed = [];
    const dialog = mount(AddRegistryUrl, {
      opened: true,
      onServerChange: (url) => changed.push(url),
      onClose: () => {},
      onNotify: () => {},
    });
    dialog.$('input').value = 'https://three.example.com';
    window.history.pushState(null, '', '/#!/taghistory/image/team/a/tag/latest');
    dialog.add();
    assert.equal(window.location.hash, '');
    assert.deepEqual(changed, ['https://three.example.com']);
  });
});
