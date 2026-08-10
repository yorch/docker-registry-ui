import assert from 'node:assert';
import { planRetention, summarizeRegistry } from '../src/scripts/registry-analysis.js';

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

  it('should not count a repository it could not read as tagless', () => {
    const summary = summarizeRegistry([record('v1', '2025-01-01')], ['team/app', 'empty', 'forbidden'], ['forbidden']);
    // `forbidden` produces no records because its tag list 401d, which is not
    // the same as the registry saying it has no tags.
    assert.equal(summary.tagless, 1, 'only the genuinely empty repository is tagless');
    assert.equal(summary.unreadable, 1);
    assert.equal(summary.repositories, 3);
  });

  it('should keep "keep newest N" correct when a neighbour has an unparseable date', () => {
    // The bad date used to make the comparator return NaN, leaving the whole
    // repository in arbitrary order so the wrong tags survived.
    const records = [
      record('broken', 'not a date'),
      record('oldest', '2024-01-01'),
      record('newest', '2026-01-01'),
      record('middle', '2025-01-01'),
    ];
    const plan = planRetention(
      records,
      { olderThanDays: 1, keepNewest: 1, protectedPatterns: [] },
      new Date('2026-08-09'),
    );
    const kept = plan.skipped.filter((s) => /Kept among newest/.test(s.reason)).flatMap((s) => s.tags);
    assert.deepEqual(kept, ['newest'], 'the genuinely newest tag is the one retained');
    // The undated record is still refused on its own merits.
    assert.ok(plan.skipped.some((s) => /Creation date unavailable/.test(s.reason)));
    assert.ok(!plan.candidates.some((c) => c.tags.includes('broken')));
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

  it('should report the newest alias date by date order, not string order', () => {
    // The second value is the later instant, but sorts first as a string
    // because its offset carries it past midnight UTC.
    const plan = planRetention(
      [record('a', '2024-03-01T00:00:00Z', 'sha256:same'), record('b', '2024-02-29T20:00:00-05:00', 'sha256:same')],
      { olderThanDays: 30, keepNewest: 0, protectedPatterns: [] },
      new Date('2026-08-09'),
    );
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0].created, '2024-02-29T20:00:00-05:00');
  });
});
