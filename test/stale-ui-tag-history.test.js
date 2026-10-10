import assert from 'node:assert';
import { component, register as registerComponent, unregister } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import AppTabs from '../src/components/app-tabs.riot';

const { DockerImage } = await import('../src/scripts/docker-image.js');
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

  before(() => registerComponent('app-tabs', AppTabs));
  after(() => unregister('app-tabs'));

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
      historyCustomLabels: [],
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

  const section = () => root.querySelector('.history-section')?.textContent.replace(/\s+/g, ' ');
  const tabs = () => root.querySelectorAll('app-tabs button');
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // R6: 'list' fired before DockerImage assigned `variants`, so the component's
  // first variant was overwritten, and the tab handler subscribed after fillInfo().
  it('should show the first architecture again after switching away and back', async () => {
    mount('oci-index');
    await until(() => tabs().length === 3 && section(), 'index history never rendered');
    const first = section();
    click(tabs()[1]);
    await until(() => section() && section() !== first, 'second tab never rendered');
    assert.match(section(), /arm64/);
    click(tabs()[0]);
    await wait(300);
    assert.equal(section(), first, `tab 1 shows: ${section()?.slice(0, 120)}`);
  });

  it('should show the second architecture after a remount served from the cache', async () => {
    const warm = mount('oci-index');
    await until(() => tabs().length === 3 && section(), 'warm never rendered');
    const first = section();
    click(tabs()[1]);
    await until(() => section() && section() !== first, 'warm second tab never rendered');
    const second = section();
    warm.unmount();
    root.replaceChildren();

    mount('oci-index');
    await until(() => tabs().length === 3 && section(), 'remount never rendered');
    click(tabs()[1]);
    await wait(300);
    assert.equal(section(), second);
  });

  // R8: opening the history after the tag list had already sent the manifest
  // requests asked for every variant a second time.
  it('should not re-request manifests that the cache already holds', async () => {
    const opts = {
      list: true,
      registryUrl: registry.url,
      onNotify: () => {},
      onAuthentication: () => {},
      isRegistrySecured: false,
    };
    const row = new DockerImage('oci-index', 'latest', opts);
    await new Promise((resolve) => {
      row.on('list', resolve);
      row.fillInfo();
    });
    await wait(200);
    const seen = [];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) {
      seen.push(args[1]);
      return open.apply(this, args);
    };
    try {
      mount('oci-index');
      await until(() => tabs().length === 3 && section(), 'history never rendered');
      await wait(300);
    } finally {
      XMLHttpRequest.prototype.open = open;
    }
    assert.ok(seen.length <= 3, `${seen.length} requests: ${seen.join(' ')}`);
  });
});
