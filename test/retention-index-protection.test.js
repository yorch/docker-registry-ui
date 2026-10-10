/*
 * Retention against a content-addressed fake registry that can tag the children
 * of an index. Deleting a manifest digest removes every tag on it and breaks
 * every index that references it, so each case asserts the dangerous outcome
 * directly: a child of a surviving index must still exist afterwards.
 */
import assert from 'node:assert';
import { component } from 'riot';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';
import { RegistryClient } from '../src/scripts/registry-client.js';
import { createFake, DOCKER_M, OCI_I } from './support/fake-registry.js';

const OLD = '2020-01-01T00:00:00Z';

describe('retention protects index children', () => {
  let reg;
  let notices;

  beforeEach(() => {
    globalThis.FormData = window.FormData;
    sessionStorage.clear();
    notices = [];
  });

  afterEach(async () => {
    document.body.replaceChildren();
    sessionStorage.clear();
    await reg?.close();
  });

  const mount = () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return component(RegistryOperations)(root, {
      registryUrl: reg.url,
      onAuthentication: () => {},
      onNotify: (message, isError) => notices.push({ message, isError }),
      isImageRemoveActivated: true,
    });
  };

  const preview = (instance, patterns = 'latest') => {
    const form = document.createElement('form');
    form.innerHTML = `<input name="olderThanDays" value="30"><input name="keepNewest" value="0"><input name="protectedPatterns" value="${patterns}">`;
    instance.previewRetention({ preventDefault() {}, currentTarget: form });
  };

  const deleteAll = async (instance) => {
    instance.selectAll();
    await instance.executeDelete();
  };

  it('keeps the tagged child of a kept OCI index (control)', async () => {
    reg = await createFake();
    const child = reg.image('amd64', OLD);
    const other = reg.image('arm64', OLD);
    reg.tag('latest', reg.index([child, other]));
    reg.tag('amd64-old', child);
    const instance = mount();
    await instance.scan();
    preview(instance);
    await deleteAll(instance);
    assert.ok(reg.exists(child.digest));
  });

  it('A: sees every page of tags/list even when the catalog primed the cache', async () => {
    reg = await createFake({ pageSize: 1 });
    const child = reg.image('amd64', OLD);
    const other = reg.image('arm64', OLD);
    reg.tag('latest', reg.index([child, other]));
    reg.tag('amd64-old', child);
    // What catalog.riot does for its tag count: same URL, so the same cache key.
    await new RegistryClient({ registryUrl: reg.url }).request(`${reg.url}/v2/app/tags/list`);
    const instance = mount();
    await instance.scan();
    assert.deepEqual(instance.state.records.map((record) => record.tag).sort(), ['amd64-old', 'latest']);
    preview(instance);
    await deleteAll(instance);
    assert.ok(reg.exists(child.digest), 'child of kept index "latest" was deleted');
  });

  it('C: protects the child of an OCI index whose children are Docker manifests', async () => {
    reg = await createFake();
    const child = reg.image('amd64', OLD, DOCKER_M);
    const other = reg.image('arm64', OLD, DOCKER_M);
    reg.tag('latest', reg.index([child, other], OCI_I));
    reg.tag('amd64-old', child);
    const instance = mount();
    await instance.scan();
    assert.equal(instance.state.records.find((record) => record.tag === 'latest').isIndex, true);
    preview(instance);
    await deleteAll(instance);
    assert.ok(reg.exists(child.digest), 'child of kept index "latest" was deleted');
  });

  it('D: refuses every candidate in a repository where an inspection failed', async () => {
    reg = await createFake();
    const child = reg.image('amd64', OLD);
    const other = reg.image('arm64', OLD);
    reg.failBlob(other.configDigest);
    reg.tag('latest', reg.index([child, other]));
    reg.tag('amd64-old', child);
    const instance = mount();
    await instance.scan();
    assert.deepEqual(
      instance.state.scanErrors.map((failure) => failure.tag),
      ['latest'],
    );
    preview(instance);
    assert.deepEqual(instance.state.plan.candidates, []);
    assert.match(
      instance.state.plan.skipped.find((entry) => entry.tags.includes('amd64-old')).reason,
      /not fully inspected/,
    );
    await deleteAll(instance);
    assert.ok(reg.exists(child.digest), 'child of kept index "latest" was deleted');
  });

  it('E: protects a tagged grandchild of a nested index', async () => {
    reg = await createFake();
    const grandchild = reg.image('amd64', OLD);
    const sibling = reg.image('arm64', OLD);
    const inner = reg.index([grandchild, sibling], OCI_I);
    reg.tag('latest', reg.index([inner], OCI_I));
    reg.tag('amd64-old', grandchild);
    const instance = mount();
    await instance.scan();
    preview(instance);
    await deleteAll(instance);
    assert.ok(reg.exists(grandchild.digest), 'grandchild of kept index deleted');
  });

  it('F: a candidate index protects its child when the user selects only the child', async () => {
    reg = await createFake();
    const child = reg.image('amd64', OLD);
    const other = reg.image('arm64', OLD);
    const index = reg.index([child, other]);
    reg.tag('old-multi', index);
    reg.tag('amd64-old', child);
    const instance = mount();
    await instance.scan();
    preview(instance, '');
    assert.deepEqual(
      instance.state.plan.candidates.map((candidate) => candidate.tags),
      [['old-multi']],
      'only the index is offered; its child waits for a later run',
    );
    await deleteAll(instance);
    assert.ok(!reg.exists(index.digest));
    assert.ok(reg.exists(child.digest), 'the child is deletable only once its index is gone');
    // The next run offers the now-unreferenced child.
    await instance.scan();
    preview(instance, '');
    assert.deepEqual(
      instance.state.plan.candidates.map((candidate) => candidate.tags),
      [['amd64-old']],
    );
  });

  it('G: an index whose delete fails never costs its child', async () => {
    reg = await createFake();
    const child = reg.image('amd64', OLD);
    const other = reg.image('arm64', OLD);
    const index = reg.index([child, other]);
    reg.tag('old-multi', index);
    reg.tag('amd64-old', child);
    const instance = mount();
    await instance.scan();
    preview(instance, '');
    reg.tag('just-pushed', index);
    await deleteAll(instance);
    assert.ok(reg.exists(index.digest));
    assert.ok(reg.exists(child.digest), 'index kept but its child deleted');
  });

  it('H: refuses to delete a candidate that an index created after the preview now references', async () => {
    reg = await createFake();
    const amd = reg.image('amd64', OLD);
    reg.tag('amd64-old', amd);
    const instance = mount();
    await instance.scan();
    preview(instance);
    instance.selectAll();
    // docker buildx imagetools create -t app:latest app:amd64-old app:arm64
    const arm = reg.image('arm64', new Date().toISOString());
    reg.tag('latest', reg.index([amd, arm]));
    await instance.executeDelete();
    assert.ok(reg.exists(amd.digest), 'child of the new app:latest index was deleted');
    assert.ok(reg.deletes.length === 0, `unexpected DELETEs: ${reg.deletes}`);
  });
});
