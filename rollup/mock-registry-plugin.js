/*
 * Boots the mock registry inside the dev server's own process.
 *
 * In the dev server's process rather than a child process so there is no second
 * command to keep alive, no extra dependency, and nothing left listening if
 * rollup exits.
 */

import { createMockRegistry } from '../dev/mock-registry/server.js';

export default function mockRegistryPlugin({ port, latency = 0 } = {}) {
  // buildStart fires again on every rebuild in watch mode, which would try to
  // bind the port a second time.
  let starting;

  return {
    name: 'mock-registry',
    async buildStart() {
      if (starting) {
        return;
      }
      starting = createMockRegistry({ port, latency });
      try {
        const registry = await starting;
        console.log(`[32mmock registry[39m listening on ${registry.url}`);
      } catch (error) {
        starting = undefined;
        this.warn(
          `could not start the mock registry on port ${port}: ${error.message}. ` +
            `Set MOCK_REGISTRY_PORT to use another port, or REGISTRY_URL to point at a real registry.`,
        );
      }
    },
  };
}
