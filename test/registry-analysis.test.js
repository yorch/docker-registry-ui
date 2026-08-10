import { planRetention, summarizeRegistry } from '../src/scripts/registry-analysis.js';
import assert from 'node:assert';

const record = (tag, created, digest = `sha256:${tag}`, repository = 'team/app') => ({
  repository,
  tag,
  digest,
  created,
  size: 100,
  layers: [
    { digest: 'sha256:shared', size: 75 },
    { digest: `sha256:${tag}`, size: 25 },
  ],
});

describe('registry analysis', () => {
  it('should distinguish logical size from unique compressed layer size', () => {
    const summary = summarizeRegistry([record('v1', '2025-01-01'), record('v2', '2025-02-01')], ['team/app', 'empty']);
    assert.equal(summary.repositories, 2);
    assert.equal(summary.tagless, 1);
    assert.equal(summary.tags, 2);
    assert.equal(summary.logicalSize, 200);
    assert.equal(summary.uniqueLayerSize, 125);
  });

  it('should protect patterns, newest tags and recent tags', () => {
    const records = [
      record('latest', '2024-01-01'),
      record('v3', '2026-01-01'),
      record('v2', '2024-02-01'),
      record('v1', '2024-01-01'),
    ];
    const plan = planRetention(
      records,
      { olderThanDays: 365, keepNewest: 1, protectedPatterns: ['latest'] },
      new Date('2026-08-09'),
    );
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.tags),
      [['v2'], ['v1']],
    );
  });

  it('should never delete a digest shared with a protected alias', () => {
    const plan = planRetention(
      [record('latest', '2024-01-01', 'sha256:same'), record('old', '2024-01-01', 'sha256:same')],
      { olderThanDays: 30, keepNewest: 0, protectedPatterns: ['latest'] },
      new Date('2026-08-09'),
    );
    assert.equal(plan.candidates.length, 0);
    assert.match(plan.skipped[0].reason, /Protected tag/);
  });

  it('should skip records without safe digest or creation date evidence', () => {
    const plan = planRetention(
      [record('no-digest', '2024-01-01', null), record('no-date', undefined)],
      { olderThanDays: 30, keepNewest: 0, protectedPatterns: [] },
      new Date('2026-08-09'),
    );
    assert.equal(plan.candidates.length, 0);
    assert.equal(plan.skipped.length, 2);
  });
});
