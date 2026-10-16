// With deleteCosignTags on, a cosign/referrers tag is only ever a companion of
// the candidate row of the image it signs: never a row of its own, never aged
// (real signature images carry a zero `created`), and never inferred from the
// absence of its subject.
import assert from 'node:assert';
import { planRetention } from '../src/scripts/registry-analysis.js';

const NOW = new Date('2026-08-09');
const ZERO = '0001-01-01T00:00:00Z';
const hex = (n) => String(n).repeat(64);
const digest = (n) => `sha256:${hex(n)}`;
const record = (tag, d, created = '2020-01-01T00:00:00Z', extra = {}) => ({
  repository: 'team/app',
  tag,
  digest: d,
  created,
  size: 100,
  layers: [],
  ...extra,
});
const sigTag = (n, suffix = '.sig') => `sha256-${hex(n)}${suffix}`;
const sig = (subject, d, suffix = '.sig', extra = {}) => record(sigTag(subject, suffix), d, ZERO, extra);
const policy = (extra = {}) => ({ olderThanDays: 30, keepNewest: 1, protectedPatterns: [], ...extra });
const on = (extra = {}) => policy({ deleteCosignTags: true, ...extra });
const rows = (plan) => plan.candidates.flatMap((c) => c.tags).sort();
const companionTags = (plan) => plan.candidates.flatMap((c) => (c.companions || []).flatMap((x) => x.tags)).sort();
const RECENT = '2026-08-01T00:00:00Z';

describe('retention cosign companions', () => {
  // v1 old (deleted), v2 recent (kept); one signature for each.
  const records = () => [
    record('v1', digest(1)),
    record('v2', digest(2), RECENT),
    sig(1, digest(8)),
    sig(2, digest(9)),
  ];

  it('offers nothing cosign-related when the box is off, and never for a non-true value', () => {
    for (const flag of [undefined, false, 'false', 'true', 1]) {
      const plan = planRetention(records(), policy({ deleteCosignTags: flag }), NOW);
      assert.deepEqual(rows(plan), ['v1']);
      assert.deepEqual(companionTags(plan), []);
    }
  });

  it('lists the signature of a deleted image as a companion of that row only', () => {
    const plan = planRetention(records(), on(), NOW);
    assert.deepEqual(rows(plan), ['v1']);
    assert.equal(plan.candidates.length, 1);
    assert.deepEqual(plan.candidates[0].companions, [{ digest: digest(8), tags: [sigTag(1)] }]);
    assert.deepEqual(companionTags(plan), [sigTag(1)]);
  });

  it('keeps the signature of a kept image', () => {
    const plan = planRetention(records(), on(), NOW);
    assert.ok(!companionTags(plan).includes(sigTag(2)));
    assert.match(plan.skipped.find((s) => s.tags.includes(sigTag(2))).reason, /not being deleted/);
  });

  it('never offers the signature of an index child', () => {
    const plan = planRetention(
      [
        record('amd64', digest(1)),
        sig(1, digest(8)),
        record('multi', digest(7), RECENT, { isIndex: true, references: [digest(1)] }),
      ],
      on({ keepNewest: 1 }),
      NOW,
    );
    assert.deepEqual(plan.candidates, []);
  });

  it('never offers a signature whose subject is not in this repository', () => {
    const plan = planRetention([record('v1', digest(1)), sig(5, digest(8))], on({ keepNewest: 0 }), NOW);
    assert.deepEqual(rows(plan), ['v1']);
    assert.deepEqual(companionTags(plan), []);
  });

  it('never offers a signature digest that also carries a kept real tag', () => {
    const plan = planRetention(
      [record('v1', digest(1)), record('keepme', digest(8), RECENT), sig(1, digest(8))],
      on({ keepNewest: 0, olderThanDays: 30 }),
      NOW,
    );
    assert.deepEqual(companionTags(plan), []);
    assert.deepEqual(rows(plan), ['v1']);
  });

  it('never offers a signature digest that also carries a real tag being deleted', () => {
    const plan = planRetention(
      [record('v1', digest(1)), record('v3', digest(3)), sig(1, digest(3))],
      on({ keepNewest: 0 }),
      NOW,
    );
    assert.deepEqual(companionTags(plan), []);
    assert.deepEqual(rows(plan), ['v1']);
  });

  it('applies protected patterns to cosign-named tags, and to a real tag sharing the digest', () => {
    const plan = planRetention(
      [record('v1', digest(1)), sig(1, digest(8), '.att')],
      on({ keepNewest: 0, protectedPatterns: ['*.att'] }),
      NOW,
    );
    assert.deepEqual(companionTags(plan), []);
    assert.deepEqual(rows(plan), ['v1']);
    const shared = planRetention(
      [record('v1', digest(1)), record('v3', digest(3)), sig(1, digest(3), '.att')],
      on({ keepNewest: 0, protectedPatterns: ['*.att'] }),
      NOW,
    );
    assert.deepEqual(rows(shared), ['v1']);
  });

  it('offers nothing for a repository that was not fully inspected', () => {
    const plan = planRetention(records(), on(), NOW, ['team/app']);
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(companionTags(plan), []);
  });

  it('offers nothing in the cascade fixture where signatures sit on each other digests', () => {
    const plan = planRetention(
      [record('v1', digest(1)), record('v2', digest(2), RECENT), sig(1, digest(3)), sig(2, digest(1))],
      on(),
      NOW,
    );
    assert.deepEqual(plan.candidates, []);
  });

  it('keeps a signature whose digest an index references', () => {
    const plan = planRetention(
      [
        record('v1', digest(1)),
        sig(1, digest(8)),
        record('multi', digest(7), RECENT, { isIndex: true, references: [digest(8)] }),
      ],
      on(),
      NOW,
    );
    assert.deepEqual(companionTags(plan), []);
  });

  it('never ages a signature: a recent one still goes with its old image', () => {
    const plan = planRetention(
      [record('v1', digest(1)), record('v2', digest(2), RECENT), record(sigTag(1), digest(8), RECENT)],
      on(),
      NOW,
    );
    assert.deepEqual(companionTags(plan), [sigTag(1)]);
  });

  it('offers nothing when one signature digest is shared by the signatures of several images', () => {
    const plan = planRetention(
      [record('a', digest(1)), record('b', digest(2)), sig(1, digest(9), '.att'), sig(2, digest(9), '.att')],
      on({ keepNewest: 0 }),
      NOW,
    );
    assert.deepEqual(rows(plan), ['a', 'b']);
    assert.deepEqual(companionTags(plan), []);
    assert.match(plan.skipped.find((s) => s.digest === digest(9)).reason, /more than one image/);
  });

  it('does not match a subject in one repository to a signature in another', () => {
    const plan = planRetention(
      [record('a', digest(1)), { ...sig(1, digest(8)), repository: 'team/other' }],
      on({ keepNewest: 0 }),
      NOW,
    );
    assert.deepEqual(companionTags(plan), []);
  });

  it('lists a cosign-named tag without a digest as skipped, with the box on or off', () => {
    const noDigest = { ...sig(1, undefined) };
    for (const options of [policy(), on()]) {
      const plan = planRetention([record('a', digest(1)), noDigest], options, NOW);
      assert.ok(plan.skipped.some((s) => s.tags.includes(sigTag(1))));
    }
  });
});
