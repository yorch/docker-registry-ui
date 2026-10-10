/*
 * The alias snapshot guards each DELETE against a tag pushed since the preview.
 * Taken once per repository it ages for the whole run, so the window in which a
 * push goes unseen grows with the number of deletes. It is re-taken every N
 * deletes or T seconds. The client is stubbed: what is under test is when the
 * component asks for a new snapshot, not what a snapshot contains.
 */
import assert from 'node:assert';
import { component } from 'riot';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';

describe('retention alias re-snapshot', () => {
  let snapshots;
  let deleted;
  let realNow;

  const mount = (candidates) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const instance = component(RegistryOperations)(root, {
      registryUrl: 'https://registry.example',
      onAuthentication: () => {},
      onNotify: () => {},
      isImageRemoveActivated: true,
    });
    instance.client = () => ({
      currentAliases: async (repository) => {
        snapshots.push(repository);
        return {
          aliases: new Map(candidates.map((candidate) => [candidate.digest, candidate.tags])),
          referenced: new Map(),
        };
      },
      deleteManifest: async (_repository, digest) => {
        deleted.push(digest);
      },
    });
    instance.update({
      plan: { registryUrl: 'https://registry.example', candidates, skipped: [] },
      selected: new Set(candidates.map(instance.candidateKey)),
    });
    return instance;
  };

  const candidates = (count, repository = 'team/app') =>
    Array.from({ length: count }, (_, i) => ({
      repository,
      digest: `sha256:${String(i).padStart(64, '0')}`,
      tags: [`v${i}`],
      created: '2020-01-01',
      size: 1,
    }));

  beforeEach(() => {
    snapshots = [];
    deleted = [];
    realNow = Date.now;
    globalThis.FormData = window.FormData;
  });

  afterEach(() => {
    Date.now = realNow;
    document.body.replaceChildren();
  });

  it('should take one snapshot for a short run', async () => {
    await mount(candidates(10)).executeDelete();
    assert.equal(deleted.length, 10);
    assert.equal(snapshots.length, 1);
  });

  it('should re-snapshot after every 25 deletes in a repository', async () => {
    await mount(candidates(60)).executeDelete();
    assert.equal(deleted.length, 60);
    assert.equal(snapshots.length, 3, 'deletes 1-25, 26-50 and 51-60 each start from a fresh snapshot');
  });

  it('should re-snapshot once 30 seconds have passed', async () => {
    let clock = 1_000_000;
    Date.now = () => clock;
    const instance = mount(candidates(4));
    instance.client = ((original) => () => {
      const client = original();
      const remove = client.deleteManifest;
      client.deleteManifest = async (...args) => {
        clock += 20_000;
        return remove(...args);
      };
      return client;
    })(instance.client);
    await instance.executeDelete();
    assert.equal(deleted.length, 4);
    assert.ok(snapshots.length >= 2, `expected a time-based re-snapshot, got ${snapshots.length}`);
  });

  it('should keep snapshots per repository', async () => {
    await mount([...candidates(3, 'a'), ...candidates(3, 'b')]).executeDelete();
    assert.equal(snapshots.length, 2);
  });
});
