/*
 * APP_NAME replaced DOCKER_REGISTRY_UI_TITLE, whose prefix named a product that
 * no longer exists. The old name is not read at all: the only people who could
 * have set it are migrating from upstream, who already have to re-read the docs
 * for the image path and CORS changes, and the failure is a header showing the
 * default name -- visible the moment you load the page, and harmless meanwhile.
 *
 * Tested against the resolver rather than a mounted component: the root
 * component imports `.version.json`, which rollup generates at build time, and
 * CI runs `npm test` before `npm run build`.
 */
import assert from 'node:assert';
import { DEFAULT_APP_NAME, resolveAppName } from '../src/scripts/utils.js';

describe('application name', () => {
  it('should use APP_NAME when it is set', () => {
    assert.equal(resolveAppName('Acme Registries'), 'Acme Registries');
  });

  it('should default when it is unset', () => {
    // The entrypoint substitutes every placeholder whether the variable is set
    // or not, so an empty string is the ordinary case rather than an edge one.
    assert.equal(resolveAppName(''), DEFAULT_APP_NAME);
    assert.equal(resolveAppName(undefined), DEFAULT_APP_NAME);
  });

  it('should ignore a whitespace-only value', () => {
    assert.equal(resolveAppName('   '), DEFAULT_APP_NAME);
  });
});
