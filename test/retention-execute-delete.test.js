/*
 * The destructive path of retention, driven through the mounted component
 * against the mock registry. A small pass-through proxy sits in front of the
 * mock so a test can count DELETEs (the assertion that matters: "zero DELETEs"
 * is how a refusal is told apart from a delete that merely failed) and make one
 * of them return 500, which the mock cannot do.
 */
import assert from 'node:assert';
import { createServer } from 'node:http';
import { component } from 'riot';
import { createMockRegistry } from '../dev/mock-registry/server.js';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';

const fixture = (name, tags = ['v1']) => ({ name, tags, architecture: 'amd64', layerSizes: [1000] });

const startProxy = async (upstream) => {
  const deletes = [];
  const failing = new Set();
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') {
      deletes.push(req.url);
      if ([...failing].some((fragment) => req.url.includes(fragment))) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }
    }
    const response = await fetch(upstream + req.url, {
      method: req.method,
      headers: { accept: req.headers.accept || '' },
    });
    const headers = Object.fromEntries(response.headers);
    delete headers['content-encoding'];
    delete headers['content-length'];
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return {
    url: `http://localhost:${server.address().port}`,
    deletes,
    failing,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe('retention executeDelete', () => {
  let registry;
  let proxy;
  let notices;
  let changed;

  const mount = (props = {}) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const instance = component(RegistryOperations)(root, {
      registryUrl: proxy.url,
      onAuthentication: () => {},
      onNotify: (message, isError) => notices.push({ message, isError }),
      onRegistryChanged: () => changed++,
      isImageRemoveActivated: true,
      ...props,
    });
    return { instance, root };
  };

  // Scans, then previews through the real form handler so the plan carries
  // whatever previewRetention stamps on it.
  const scanAndPreview = async (instance) => {
    await instance.scan();
    const form = document.createElement('form');
    form.innerHTML =
      '<input name="olderThanDays" value="1"><input name="keepNewest" value="0"><input name="protectedPatterns" value="">';
    instance.previewRetention({ preventDefault() {}, currentTarget: form });
  };

  const resolves = async (repository, tag) =>
    (
      await fetch(`${registry.url}/v2/${repository}/manifests/${tag}`, {
        headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      })
    ).status === 200;

  const selectAll = (instance) => {
    instance.selectAll();
    return instance.state.plan.candidates;
  };

  beforeEach(async () => {
    globalThis.FormData = window.FormData;
    sessionStorage.clear();
    notices = [];
    changed = 0;
  });

  afterEach(async () => {
    document.body.replaceChildren();
    sessionStorage.clear();
    await proxy?.close();
    await registry?.close();
  });

  const start = async (fixtures) => {
    registry = await createMockRegistry({ port: 0, fixtures });
    proxy = await startProxy(registry.url);
  };

  it('should delete only the previewed digests that were selected', async () => {
    await start([fixture('team/one'), fixture('team/two')]);
    const { instance } = mount();
    await scanAndPreview(instance);
    const [first, second] = instance.state.plan.candidates;
    assert.equal(instance.state.plan.candidates.length, 2);
    instance.update({ selected: new Set([instance.candidateKey(first)]) });

    await instance.executeDelete();

    assert.equal(proxy.deletes.length, 1);
    assert.ok(proxy.deletes[0].includes(first.digest));
    assert.equal(await resolves(first.repository, 'v1'), false);
    assert.equal(await resolves(second.repository, 'v1'), true, 'the unselected candidate is untouched');
    assert.equal(changed, 1);
  });

  it('should refuse, with zero DELETEs, when a tag was pushed after the preview', async () => {
    await start([fixture('team/one', ['v1', 'v2'])]);
    const { instance } = mount();
    await scanAndPreview(instance);
    const [candidate] = selectAll(instance) || [];
    // The preview listed v1 and v2 on this digest; a push since then means the
    // live digest carries a tag the preview never showed. Modelled by removing
    // one from the preview, which is the same disagreement seen from the other side.
    candidate.tags = candidate.tags.filter((tag) => tag !== 'v2');

    await instance.executeDelete();

    assert.equal(proxy.deletes.length, 0);
    assert.match(instance.state.deleteFailures[0], /Tags changed since the preview/);
    assert.equal(await resolves('team/one', 'v2'), true);
    assert.ok(instance.state.plan, 'nothing was deleted, so the plan survives');
    assert.equal(changed, 0);
  });

  it('should report "deleted X of N" on a partial failure and drop the stale plan', async () => {
    await start([fixture('team/one'), fixture('team/two')]);
    const { instance } = mount();
    await scanAndPreview(instance);
    const candidates = selectAll(instance);
    proxy.failing.add(candidates[1].digest);

    await instance.executeDelete();

    assert.equal(proxy.deletes.length, 2);
    assert.equal(instance.state.deleteFailures.length, 1);
    assert.match(notices.at(-1).message, /^1 of 2 manifests deleted/);
    assert.equal(notices.at(-1).isError, true);
    assert.equal(instance.state.plan, undefined, 'something was deleted, so the inventory is stale');
    assert.equal(changed, 1);
  });

  it('should keep the plan when every DELETE fails', async () => {
    await start([fixture('team/one')]);
    const { instance } = mount();
    await scanAndPreview(instance);
    selectAll(instance);
    proxy.failing.add('/manifests/');

    await instance.executeDelete();

    assert.match(notices.at(-1).message, /^0 of 1 manifests deleted/);
    assert.ok(instance.state.plan, 'the registry is unchanged, so the plan is still accurate');
    assert.equal(changed, 0);
  });

  it('should do nothing when image removal is not activated', async () => {
    await start([fixture('team/one')]);
    const { instance } = mount({ isImageRemoveActivated: false });
    await scanAndPreview(instance);
    selectAll(instance);

    await instance.executeDelete();

    assert.equal(proxy.deletes.length, 0);
    assert.equal(notices.length, 0);
  });

  it('should fail closed, with zero DELETEs, for a repository it cannot verify', async () => {
    await start([fixture('team/one'), fixture('broken-manifest', ['v1'])]);
    const { instance } = mount();
    await scanAndPreview(instance);
    // Inspection of the broken repository failed, so it is not a candidate.
    // Force one in, as a plan built before the repository broke would hold.
    const broken = { repository: 'broken-manifest', digest: 'sha256:deadbeef', tags: ['v1'], size: 1 };
    instance.update({
      plan: { ...instance.state.plan, candidates: [broken] },
      selected: new Set([instance.candidateKey(broken)]),
    });

    await instance.executeDelete();

    assert.equal(proxy.deletes.length, 0);
    assert.match(instance.state.deleteFailures[0], /broken-manifest/);
    assert.match(notices.at(-1).message, /^0 of 1 manifests deleted/);
  });

  describe('registry switch', () => {
    const switchTo = (root, instance, url) => {
      root.setAttribute('registry-url', url);
      instance.update();
    };

    it('should refuse to execute a plan made for another registry', async () => {
      await start([fixture('team/one')]);
      const { instance } = mount();
      await scanAndPreview(instance);
      selectAll(instance);
      assert.equal(instance.state.plan.registryUrl, proxy.url);
      // Simulate a switch that did not go through onBeforeUpdate's reset.
      instance.state.plan.registryUrl = 'http://elsewhere.invalid';

      await instance.executeDelete();

      assert.equal(proxy.deletes.length, 0);
      assert.match(instance.state.deleteFailures[0], /registry changed/);
      assert.equal(notices.at(-1).isError, true);
    });

    it('should drop the summary, plan and selection when registryUrl changes', async () => {
      await start([fixture('team/one')]);
      const { instance, root } = mount();
      await scanAndPreview(instance);
      selectAll(instance);
      assert.ok(instance.state.summary && instance.state.plan);

      switchTo(root, instance, 'http://other.invalid');

      assert.equal(instance.props.registryUrl, 'http://other.invalid');
      assert.equal(instance.state.summary, undefined);
      assert.equal(instance.state.plan, undefined);
      assert.equal(instance.state.selected.size, 0);
      assert.equal(instance.state.scanning, false);
    });

    it('should stop an in-flight scan from publishing after a switch', async () => {
      await start([fixture('team/one')]);
      const { instance, root } = mount();
      const scan = instance.scan();
      switchTo(root, instance, 'http://other.invalid');
      await scan;

      assert.equal(instance.state.summary, undefined, 'the stale scan must not publish its result');
      assert.equal(instance.state.scanning, false);
    });
  });
});
