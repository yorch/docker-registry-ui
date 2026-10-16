import assert from 'node:assert';
import { planRetention } from '../src/scripts/registry-analysis.js';

const record = (tag, created, digest = `sha256:${tag}`, repository = 'team/app') => ({
  repository,
  tag,
  digest,
  created,
  size: 100,
  layers: [],
});

describe('retention date trust', () => {
  const NOW = new Date('2026-08-09');
  const policy = { olderThanDays: 30, keepNewest: 2, protectedPatterns: [] };

  it('should never offer tags built with SOURCE_DATE_EPOCH=0 for deletion', () => {
    // Reproducible builds stamp 1970 or 0001-01-01. Every tag ties, so ordering
    // fell back to alphabetical and the newest releases became candidates.
    const plan = planRetention(
      [
        record('v1', '1970-01-01T00:00:00Z'),
        record('v2', '0001-01-01T00:00:00Z'),
        record('v3', '1970-01-01T00:00:00Z'),
        record('v4', '1970-01-01T00:00:00Z'),
      ],
      policy,
      NOW,
    );
    assert.equal(plan.candidates.length, 0);
    assert.equal(plan.skipped.length, 4);
    plan.skipped.forEach((entry) => assert.match(entry.reason, /No reliable build date/));
  });

  it('should still delete old tags with a real date beside untrustworthy ones', () => {
    const plan = planRetention(
      [
        record('epoch', '1970-01-01T00:00:00Z'),
        record('old', '2024-01-01'),
        record('mid', '2025-01-01'),
        record('new', '2026-08-01'),
      ],
      { ...policy, keepNewest: 1 },
      NOW,
    );
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.tags),
      [['mid'], ['old']],
    );
  });

  it('should protect cosign signature, attestation and sbom tags by default', () => {
    const hex = 'a'.repeat(64);
    const plan = planRetention(
      [
        record(`sha256-${hex}.sig`, '2020-01-01'),
        record(`sha256-${hex}.att`, '2020-01-01'),
        record(`sha256-${hex}.sbom`, '2020-01-01'),
        record('old', '2020-01-01'),
      ],
      { ...policy, keepNewest: 0 },
      NOW,
    );
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.tags),
      [['old']],
    );
    assert.equal(plan.skipped.filter((entry) => /Cosign/.test(entry.reason)).length, 3);
  });

  it('should not let cosign tags use up a keep-newest slot', () => {
    const hex = 'b'.repeat(64);
    const plan = planRetention(
      [record(`sha256-${hex}.sig`, '2026-08-08'), record('v1', '2025-01-01'), record('v2', '2024-01-01')],
      { ...policy, keepNewest: 1 },
      NOW,
    );
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.tags),
      [['v2']],
    );
  });

  it('should delete cosign tags with their image when the operator opts in, and not alone', () => {
    const hex = 'c'.repeat(64);
    const options = { ...policy, keepNewest: 0, deleteCosignTags: true };
    const withImage = planRetention(
      [record('v1', '2020-01-01', `sha256:${hex}`), record(`sha256-${hex}.sig`, '2020-01-01')],
      options,
      NOW,
    );
    assert.equal(withImage.candidates.length, 1);
    assert.deepEqual(withImage.candidates[0].companions[0].tags, [`sha256-${hex}.sig`]);
    assert.equal(planRetention([record(`sha256-${hex}.sig`, '2020-01-01')], options, NOW).candidates.length, 0);
  });

  it('should count distinct digests, not tags, for keepNewest', () => {
    const plan = planRetention(
      [
        record('1.0', '2026-08-01', 'sha256:a'),
        record('1.0.0', '2026-08-01', 'sha256:a'),
        record('1', '2026-08-01', 'sha256:a'),
        record('0.9', '2025-01-01', 'sha256:b'),
        record('0.8', '2024-01-01', 'sha256:c'),
      ],
      { ...policy, keepNewest: 2 },
      NOW,
    );
    // Two images are kept (a and b); only c is a candidate.
    assert.deepEqual(
      plan.candidates.map((candidate) => candidate.tags),
      [['0.8']],
    );
  });

  it('should not delete anything for a NaN policy', () => {
    const records = [record('old', '2020-01-01')];
    [{ olderThanDays: Number.NaN }, { keepNewest: Number.NaN }].forEach((bad) => {
      const plan = planRetention(records, { ...policy, ...bad }, NOW);
      assert.equal(plan.candidates.length, 0);
      assert.match(plan.skipped[0].reason, /Invalid retention policy/);
    });
  });
});
