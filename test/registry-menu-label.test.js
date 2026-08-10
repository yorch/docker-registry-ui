/*
 * The topbar used to render the registry URL and ignore REGISTRY_TITLE
 * entirely, while a panel further down the page rendered the title. So an
 * operator who labelled their registry "Production EU" saw the hostname in the
 * one control whose job is to say which registry they are on.
 */
import assert from 'node:assert';
import { component } from 'riot';
import RegistryMenu from '../src/components/dialogs/registry-menu.riot';

const mount = (props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(RegistryMenu)(root, props);
};

const label = (instance) => instance.$('.registry-label').textContent.trim();
const tooltip = (instance) => instance.$('.registry-trigger').getAttribute('title');

describe('registry menu label', () => {
  it('should show the configured registry name when there is one', () => {
    const menu = mount({ registryUrl: 'https://registry.example.com', registryName: 'Production EU' });
    assert.equal(label(menu), 'Production EU');
  });

  it('should keep the url reachable in the tooltip', () => {
    const menu = mount({ registryUrl: 'https://registry.example.com', registryName: 'Production EU' });
    // The name is for recognition; the URL is what you need when debugging.
    assert.equal(tooltip(menu), 'https://registry.example.com');
  });

  it('should fall back to the host when no name is configured', () => {
    const menu = mount({ registryUrl: 'https://registry.example.com' });
    assert.equal(label(menu), 'registry.example.com');
  });

  it('should fall back to the host when the name is empty', () => {
    // REGISTRY_TITLE unset is substituted as an empty string by the entrypoint,
    // so the empty case is the common one rather than an edge case.
    const menu = mount({ registryUrl: 'https://registry.example.com', registryName: '' });
    assert.equal(label(menu), 'registry.example.com');
  });

  it('should say something when there is no registry at all', () => {
    const menu = mount({ registryUrl: '' });
    assert.equal(label(menu), 'Registry');
  });
});
