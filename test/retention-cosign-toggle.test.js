// The retention form's "Also delete signature and attestation tags (cosign)"
// checkbox drives planRetention's deleteCosignTags. Default off.
import assert from 'node:assert';
import { component } from 'riot';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';
import { summarizeRegistry } from '../src/scripts/registry-analysis.js';

const HEX = 'a'.repeat(64);
const record = (tag, digest) => ({
  repository: 'team/app',
  tag,
  digest,
  created: '2020-01-01T00:00:00Z',
  size: 10,
  layers: [],
});

describe('retention form: cosign tags toggle', () => {
  let instance;
  let root;
  let notices;

  const mount = () => {
    notices = [];
    globalThis.FormData = window.FormData;
    root = document.createElement('div');
    document.body.appendChild(root);
    instance = component(RegistryOperations)(root, {
      registryUrl: 'https://registry.example',
      onAuthentication: () => {},
      onNotify: (message, isError) => notices.push({ message, isError }),
      isImageRemoveActivated: true,
    });
    const records = [record('v1', `sha256:${HEX}`), record(`sha256-${HEX}.sig`, 'sha256:bbb')];
    instance.scanRegistryUrl = 'https://registry.example';
    instance.update({
      expanded: true,
      records,
      summary: summarizeRegistry(records, ['team/app'], []),
      policy: { olderThanDays: 0, keepNewest: 0, protectedPatterns: '' },
    });
  };
  const preview = () => {
    root.querySelector('form.retention-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  };
  const box = () => root.querySelector('input[name="deleteCosignTags"]');
  const candidateTags = () => instance.state.plan.candidates.flatMap((candidate) => candidate.tags);

  afterEach(() => document.body.replaceChildren());

  it('is unchecked by default and the plan protects the signature tag', () => {
    mount();
    assert.ok(box(), 'checkbox is missing');
    assert.equal(box().checked, false);
    assert.match(
      root.querySelector('form.retention-form').textContent,
      /Also delete the signature and attestation tags of the images being deleted/,
    );
    preview();
    assert.deepEqual(candidateTags(), ['v1']);
  });

  it('offers the signature tag once checked', () => {
    mount();
    box().checked = true;
    preview();
    assert.deepEqual(candidateTags(), ['v1']);
    assert.deepEqual(instance.state.plan.candidates[0].companions, [
      { digest: 'sha256:bbb', tags: [`sha256-${HEX}.sig`] },
    ]);
    assert.match(root.querySelector('.candidate-table').textContent, /\+ signature: sha256-a+\.sig/);
    assert.equal(instance.state.plan.deleteCosignTags, true);
    assert.equal(instance.state.policy.deleteCosignTags, true);
  });

  it('clears a previous plan and selection when the box is toggled', () => {
    mount();
    preview();
    instance.update({ selected: new Set(['team/app:sha256:aaa']) });
    assert.ok(instance.state.plan);
    box().checked = true;
    box().dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(instance.state.plan, undefined);
    assert.equal(instance.state.selected.size, 0);
    assert.equal(instance.state.policy.deleteCosignTags, true);
  });

  it('refuses to execute a plan built under a different cosign setting', async () => {
    mount();
    const deleted = [];
    instance.client = () => ({
      currentAliases: async () => ({ aliases: new Map(), referenced: new Map() }),
      deleteManifest: async (_r, d) => deleted.push(d),
    });
    const candidate = { repository: 'team/app', digest: 'sha256:aaa', tags: ['v1'], created: '2020-01-01', size: 1 };
    instance.update({
      plan: { registryUrl: 'https://registry.example', candidates: [candidate], skipped: [], deleteCosignTags: false },
      selected: new Set([instance.candidateKey(candidate)]),
      policy: { ...instance.state.policy, deleteCosignTags: true },
    });
    await instance.executeDelete();
    assert.deepEqual(deleted, []);
    assert.match(instance.state.deleteFailures[0], /cosign tag option changed/);
  });

  describe('executing a plan with companions', () => {
    const candidate = {
      repository: 'team/app',
      digest: 'sha256:aaa',
      tags: ['v1'],
      created: '2020-01-01',
      size: 1,
      companions: [{ digest: 'sha256:sig', tags: ['sha256-aaa.sig'] }],
    };
    const run = async ({ aliases, referenced = new Map(), failDelete } = {}) => {
      mount();
      const deleted = [];
      instance.client = () => ({
        currentAliases: async () => ({
          aliases:
            aliases ||
            new Map([
              ['sha256:aaa', ['v1']],
              ['sha256:sig', ['sha256-aaa.sig']],
            ]),
          referenced,
        }),
        deleteManifest: async (_repository, d) => {
          if (d === failDelete) throw new Error('registry said no');
          deleted.push(d);
        },
      });
      instance.update({
        plan: { registryUrl: 'https://registry.example', candidates: [candidate], skipped: [], deleteCosignTags: true },
        selected: new Set([instance.candidateKey(candidate)]),
        policy: { ...instance.state.policy, deleteCosignTags: true },
      });
      await instance.executeDelete();
      return deleted;
    };

    it('deletes the image first and then its signature', async () => {
      assert.deepEqual(await run(), ['sha256:aaa', 'sha256:sig']);
    });

    it('keeps the signature when the image is refused by the fresh alias check', async () => {
      const deleted = await run({
        aliases: new Map([
          ['sha256:aaa', ['v1', 'pushed-since']],
          ['sha256:sig', ['sha256-aaa.sig']],
        ]),
      });
      assert.deepEqual(deleted, []);
    });

    it('keeps the signature when deleting the image fails', async () => {
      assert.deepEqual(await run({ failDelete: 'sha256:aaa' }), []);
    });

    it('refuses a signature digest that gained another tag, but still deletes the image', async () => {
      const deleted = await run({
        aliases: new Map([
          ['sha256:aaa', ['v1']],
          ['sha256:sig', ['sha256-aaa.sig', 'mine']],
        ]),
      });
      assert.deepEqual(deleted, ['sha256:aaa']);
      assert.match(instance.state.deleteFailures[0], /sha256-aaa\.sig was kept/);
    });

    it('refuses a signature digest that an index now references', async () => {
      const deleted = await run({ referenced: new Map([['sha256:sig', ['multi']]]) });
      assert.deepEqual(deleted, ['sha256:aaa']);
      assert.match(instance.state.deleteFailures[0], /referenced by index multi/);
    });

    it('cannot select a signature on its own', async () => {
      mount();
      const records = [
        {
          repository: 'team/app',
          tag: 'v1',
          digest: 'sha256:aaa',
          created: '2020-01-01T00:00:00Z',
          size: 1,
          layers: [],
        },
        {
          repository: 'team/app',
          tag: `sha256-${'a'.repeat(64)}.sig`,
          digest: 'sha256:sig',
          created: '0001-01-01T00:00:00Z',
          size: 1,
          layers: [],
        },
      ];
      instance.update({
        records,
        policy: { olderThanDays: 0, keepNewest: 0, protectedPatterns: '', deleteCosignTags: true },
      });
      preview();
      assert.deepEqual(
        instance.state.plan.candidates.map((c) => c.tags),
        [['v1']],
      );
      instance.update({ selected: new Set(['team/app:sha256:sig']) });
      assert.deepEqual(instance.selectedCandidates(), []);
    });

    const many = (count) =>
      Array.from({ length: count }, (_, i) => ({
        repository: 'team/app',
        digest: `sha256:i${i}`,
        tags: [`v${i}`],
        created: '2020-01-01',
        size: 1,
        companions: [{ digest: `sha256:s${i}`, tags: [`sha256-i${i}.sig`] }],
      }));
    const runMany = async (list, { failDelete = () => false, onSnapshot } = {}) => {
      mount();
      const deleted = [];
      instance.client = () => ({
        currentAliases: async () => {
          onSnapshot?.();
          const aliases = new Map();
          list.forEach((c) => {
            aliases.set(c.digest, c.tags);
            c.companions.forEach((x) => aliases.set(x.digest, x.tags));
          });
          return { aliases, referenced: new Map() };
        },
        deleteManifest: async (_r, d) => {
          if (failDelete(d)) throw new Error('registry said no');
          deleted.push(d);
        },
      });
      instance.update({
        plan: { registryUrl: 'https://registry.example', candidates: list, skipped: [], deleteCosignTags: true },
        selected: new Set(list.map(instance.candidateKey)),
        policy: { ...instance.state.policy, deleteCosignTags: true },
      });
      await instance.executeDelete();
      return { deleted };
    };

    it('never deletes one companion digest twice, nor reports it kept', async () => {
      const [a, b] = many(2);
      b.companions = [{ ...a.companions[0] }];
      const { deleted } = await runMany([a, b]);
      assert.equal(deleted.filter((d) => d === a.companions[0].digest).length, 1);
      assert.deepEqual(instance.state.deleteFailures, []);
    });

    it('does not delete a shared signature digest when only one of its images is selected', async () => {
      const [a] = many(1);
      const { deleted } = await runMany([{ ...a, companions: [] }]);
      assert.deepEqual(deleted, ['sha256:i0']);
    });

    it('counts companion manifests in the confirm copy', async () => {
      mount();
      const list = many(2);
      instance.update({
        plan: { registryUrl: 'https://registry.example', candidates: list, skipped: [], deleteCosignTags: true },
        selected: new Set(list.map(instance.candidateKey)),
        confirming: true,
      });
      const text = root.textContent.replace(/\s+/g, ' ');
      assert.match(text, /Delete 4 manifests \(2 images \+ 2 signature or attestation\)/);
      assert.match(text, /all 4 attached tags/);
    });

    it('reports the number of manifests actually deleted when only a companion fails', async () => {
      const list = many(2);
      await runMany(list, { failDelete: (d) => d === 'sha256:s0' });
      assert.match(instance.state.deleteFailures[0], /was kept/);
      assert.match(notices.at(-1).message, /^3 of 4 manifests deleted/);
    });

    it('says how many manifests were deleted, signatures included', async () => {
      await runMany(many(2));
      assert.match(notices.at(-1).message, /^4 manifests deleted/);
    });

    it('renews the alias snapshot after 25 deletes, companions included', async () => {
      let snapshots = 0;
      // 14 images + 14 signatures = 28 deletes: a second snapshot is needed.
      const { deleted } = await runMany(many(14), { onSnapshot: () => snapshots++ });
      assert.equal(deleted.length, 28);
      assert.equal(snapshots, 2);
    });
  });
});
