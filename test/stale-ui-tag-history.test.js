import { register } from 'node:module';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';

// tag-history-element imports an .svg, which the shared riot loader cannot
// load. Stub images out for this file only, before the component is imported.
register(
  `data:text/javascript,${encodeURIComponent(`export async function load(url, context, nextLoad) {
    if (url.endsWith('.svg')) return { format: 'module', shortCircuit: true, source: 'export default "";' };
    return nextLoad(url, context);
  }`)}`,
);
const { default: TagHistory } = await import('../src/components/tag-history/tag-history.riot');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, message) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(30);
  }
  throw new Error(message);
};

describe('tag history stale UI', function () {
  this.timeout(20000);

  let registry;
  let root;

  beforeEach(async () => {
    sessionStorage.clear();
    registry = await createMockRegistry({ port: 0 });
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await registry.close();
  });

  const mount = (image) =>
    component(TagHistory)(root, {
      image,
      tag: 'latest',
      registryUrl: registry.url,
      onNotify: () => {},
      onAuthentication: () => {},
      isRegistrySecured: false,
    });

  const loaded = () => root.querySelectorAll('.history-section').length > 0 && !root.querySelector('.spinner');

  it('should render the history on a cold load', async () => {
    mount('nginx');
    await until(loaded, 'history never rendered');
  });

  // H11: a cache hit replays the response synchronously, so the events fired
  // inside onBeforeMount, before the listeners were attached in onMounted, and
  // the spinner never went away.
  it('should render the history when every response comes from the cache', async () => {
    const warm = mount('nginx');
    await until(loaded, 'history never rendered');
    warm.unmount();
    root.replaceChildren();

    mount('nginx');
    await until(loaded, 'history stayed on the spinner after a cache hit');
  });

  it('should render a multi-architecture history when every response comes from the cache', async () => {
    const warm = mount('oci-index');
    await until(() => root.querySelector('app-tabs') && loaded(), 'index history never rendered');
    warm.unmount();
    root.replaceChildren();

    mount('oci-index');
    await until(() => root.querySelector('app-tabs') && loaded(), 'index history stayed on the spinner');
  });
});
