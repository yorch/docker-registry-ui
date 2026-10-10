import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { component } from 'riot';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';
import { getFromCache } from '../src/scripts/cache-request.js';
import { Http } from '../src/scripts/http.js';
import { planRetention } from '../src/scripts/registry-analysis.js';

const d = (n) => `sha256:${String(n).padStart(64, '0')}`;
const OLD = '2024-01-01T00:00:00Z';
const OLDER = '2023-01-01T00:00:00Z';
const NOW = new Date('2026-10-10T00:00:00Z');
const policy = (keepNewest) => ({ olderThanDays: 90, keepNewest, protectedPatterns: [] });
const image = (tag, digest, created) => ({ repository: 'app', tag, digest, created, isIndex: false, references: [] });
const index = (tag, digest, created, children) => ({
  repository: 'app',
  tag,
  digest,
  created,
  isIndex: true,
  references: children,
  platforms: children.map((digest) => ({ digest })),
});
const candidateTags = (plan) => plan.candidates.flatMap((c) => c.tags).sort();

describe('retention ranking and protection (review of PR 27)', () => {
  it('should keep the newest release when its tagged platform child ties with it', () => {
    // Tag list order (lexical): arm64-v2 < v1 < v2. Index created = newest child, so they tie.
    const records = [image('arm64-v2', d(1), OLD), index('v1', d(3), OLDER, [d(4)]), index('v2', d(2), OLD, [d(1)])];
    const plan = planRetention(records, policy(1), NOW);
    assert.deepEqual(candidateTags(plan), ['v1'], 'the newest release v2 and its child are kept');
  });

  it('should keep N releases, not N-1, when each has a tagged child', () => {
    const records = [
      index('v3', d(30), '2024-03-01T00:00:00Z', [d(31)]),
      image('v3-amd64', d(31), '2024-03-01T00:00:00Z'),
      index('v2', d(20), '2024-02-01T00:00:00Z', [d(21)]),
      image('v2-amd64', d(21), '2024-02-01T00:00:00Z'),
      index('v1', d(10), '2024-01-01T00:00:00Z', [d(11)]),
      image('v1-amd64', d(11), '2024-01-01T00:00:00Z'),
    ];
    const plan = planRetention(records, policy(3), NOW);
    assert.deepEqual(candidateTags(plan), [], 'all 3 requested releases are kept');
  });

  it('should protect the OCI 1.1 referrers fallback tag (sha256-<hex>, no suffix)', () => {
    const subject = 'a'.repeat(64);
    const records = [
      image('v1', `sha256:${subject}`, '2026-10-01T00:00:00Z'),
      index(`sha256-${subject}`, d(9), OLD, [d(8)]),
    ];
    const plan = planRetention(records, policy(0), NOW);
    assert.deepEqual(candidateTags(plan), []);
    assert.match(plan.skipped.find((e) => e.tags[0] === `sha256-${subject}`).reason, /Cosign/);
  });

  it('should keep protecting the children of an index with a cosign-shaped name', () => {
    const records = [index(`sha256-${'b'.repeat(64)}.att`, d(5), OLD, [d(6)]), image('old-child', d(6), OLDER)];
    const plan = planRetention(records, policy(0), NOW);
    assert.deepEqual(candidateTags(plan), [], 'an index still references the child');
  });
});

describe('alias snapshot age (review of PR 27)', () => {
  let realNow;
  beforeEach(() => {
    realNow = Date.now;
    globalThis.FormData = window.FormData;
  });
  afterEach(() => {
    Date.now = realNow;
    document.body.replaceChildren();
  });

  it('should not re-take a snapshot just because building it was slow', async () => {
    let clock = 1_000_000;
    Date.now = () => clock;
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      repository: 'team/app',
      digest: d(i),
      tags: [`v${i}`],
      created: OLD,
      size: 1,
    }));
    let snapshots = 0;
    const root = document.createElement('div');
    document.body.appendChild(root);
    const instance = component(RegistryOperations)(root, {
      registryUrl: 'https://registry.example',
      onAuthentication: () => {},
      onNotify: () => {},
      isImageRemoveActivated: true,
    });
    instance.client = () => ({
      currentAliases: async () => {
        snapshots++;
        await Promise.resolve();
        clock += 31_000; // listing + re-reading a large repository takes 31s
        return { aliases: new Map(candidates.map((c) => [c.digest, c.tags])), referenced: new Map() };
      },
      deleteManifest: async () => {},
    });
    instance.update({
      plan: { registryUrl: 'https://registry.example', candidates, skipped: [] },
      selected: new Set(candidates.map(instance.candidateKey)),
    });
    await instance.executeDelete();
    assert.equal(snapshots, 1, 'a snapshot is as old as when it finished, not when it started');
  });
});

describe('verified cache entries carry the verified digest (review of PR 27)', () => {
  let server;
  let base;
  const body = '{"schemaVersion":2}';
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  beforeEach(async () => {
    sessionStorage.clear();
    server = createServer((_req, res) => {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Docker-Content-Digest',
        'Docker-Content-Digest': d(666),
      });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  it('should cache the verified digest, not a header the registry made up', async () => {
    await new Promise((resolve) => {
      const req = new Http({});
      req.addEventListener('loadend', () => resolve());
      req.open('GET', `${base}/v2/x/manifests/${digest}`);
      req.send();
    });
    await new Promise((r) => setTimeout(r, 50));
    const other = `https://trusted.example/v2/y/manifests/${digest}`;
    assert.equal(getFromCache('GET', other)?.dockerContentdigest, digest);
  });
});

describe('cosign tag sharing a digest with a real tag (second review of PR 27)', () => {
  it('should protect the real tag instead of offering a delete that would take the cosign tag too', () => {
    const subject = 'c'.repeat(64);
    const records = [image('v1', d(1), OLDER), image(`sha256-${subject}`, d(1), OLDER)];
    const plan = planRetention(records, policy(0), NOW);
    assert.deepEqual(candidateTags(plan), []);
    const entry = plan.skipped.find((e) => e.tags.includes('v1'));
    assert.match(entry.reason, /Cosign/);
  });
});
