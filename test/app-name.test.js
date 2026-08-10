/*
 * APP_NAME replaced DOCKER_REGISTRY_UI_TITLE, whose prefix named a product that
 * no longer exists. The old variable is still honoured because dropping it
 * would reset a customised header to the default on upgrade without saying
 * anything -- and a silent reset is the whole reason the alias is worth
 * carrying.
 *
 * Tested against the resolver rather than a mounted component: the root
 * component imports `.version.json`, which rollup generates at build time, and
 * CI runs `npm test` before `npm run build`.
 */
import assert from 'node:assert';
import { DEFAULT_APP_NAME, resolveAppName } from '../src/scripts/utils.js';

describe('application name', () => {
  it('should use APP_NAME when it is set', () => {
    assert.equal(resolveAppName('Acme Registries', ''), 'Acme Registries');
  });

  it('should still honour the deprecated variable on its own', () => {
    assert.equal(resolveAppName('', 'Legacy Title'), 'Legacy Title');
  });

  it('should prefer APP_NAME when both are set', () => {
    assert.equal(resolveAppName('New', 'Old'), 'New');
  });

  it('should fall through an empty APP_NAME to the deprecated variable', () => {
    // The upgrade path: the entrypoint substitutes APP_NAME as "" because it is
    // unset, while the old variable still carries the operator's customisation.
    assert.equal(resolveAppName('', 'Legacy Title'), 'Legacy Title');
  });

  it('should default when neither is set', () => {
    assert.equal(resolveAppName('', ''), DEFAULT_APP_NAME);
    assert.equal(resolveAppName(undefined, undefined), DEFAULT_APP_NAME);
  });

  it('should ignore whitespace-only values', () => {
    assert.equal(resolveAppName('   ', ''), DEFAULT_APP_NAME);
    assert.equal(resolveAppName('   ', 'Legacy Title'), 'Legacy Title');
  });
});
