/*
 * An unparseable `created` used to make byNewest return NaN, which is not a
 * consistent comparator: sort() is then free to leave the whole repository in
 * arbitrary order, so "keep the newest N" could retain the wrong N. The record
 * carrying the bad date is blocked from deletion by its own check either way --
 * the damage was to its neighbours. A finite sentinel sorts it last and keeps
 * the ordering total (subtracting two sentinels gives 0, not NaN).
 */
/*
 * Reproducible builds (SOURCE_DATE_EPOCH=0: ko, rules_oci, nix) stamp 1970 or
 * 0001-01-01. Those say nothing about when the image was made, and they all tie,
 * so ordering by them is arbitrary. Nothing real predates this cutoff.
 */
const EARLIEST_TRUSTED_MS = Date.UTC(2000, 0, 1);

const reliableTime = (created) => {
  if (!created) return undefined;
  const time = new Date(created).getTime();
  return Number.isNaN(time) || time < EARLIEST_TRUSTED_MS ? undefined : time;
};

const timeOf = (record) => reliableTime(record.created) ?? Number.MIN_SAFE_INTEGER;

// cosign stores signatures, attestations and SBOMs as tags named after the
// digest they describe: sha256-<hex>.sig, .att, .sbom. The OCI 1.1 referrers
// fallback uses the bare sha256-<hex> for an index of signatures/SBOMs.
const COSIGN_TAG_REGEX = /^sha256-[a-f0-9]{64}(\.(sig|att|sbom))?$/;

const byNewest = (left, right) => timeOf(right) - timeOf(left);

const compilePatterns = (patterns) =>
  (patterns || [])
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`);
    });

/*
 * `unreadableRepositories` are the ones whose tag list could not be fetched at
 * all. They produce no records, so counting them as tagless would report a
 * repository that may be full of tags as empty -- and contradict the "N could
 * not be inspected" warning shown beside the figure.
 */
export const summarizeRegistry = (records, repositoryNames = [], unreadableRepositories = []) => {
  const unreadable = new Set(unreadableRepositories);
  const layers = new Map();
  const manifests = new Set();
  const repositories = new Map(repositoryNames.map((name) => [name, { name, tags: 0, size: 0 }]));
  records.forEach((record) => {
    const repository = repositories.get(record.repository) || { name: record.repository, tags: 0, size: 0 };
    repository.tags++;
    record.layers?.forEach((layer) => {
      if (!layers.has(layer.digest)) layers.set(layer.digest, Number(layer.size) || 0);
    });
    repository.size += Number(record.size) || 0;
    repositories.set(record.repository, repository);
    if (record.digest) manifests.add(`${record.repository}:${record.digest}`);
  });
  return {
    repositories: repositories.size,
    tags: records.length,
    tagless: [...repositories.values()].filter((r) => r.tags === 0 && !unreadable.has(r.name)).length,
    unreadable: unreadable.size,
    manifests: manifests.size,
    uniqueLayerSize: [...layers.values()].reduce((total, size) => total + size, 0),
    logicalSize: records.reduce((total, record) => total + (Number(record.size) || 0), 0),
    largestRepositories: [...repositories.values()].sort((left, right) => right.size - left.size).slice(0, 5),
  };
};

/*
 * `unverifiedRepositories` are repositories where any tag could not be inspected.
 * An index that failed inspection leaves no record, so nothing in the plan can
 * say what it references; the only safe reading is that any candidate in that
 * repository might be one of its children, and none is offered.
 */
export const planRetention = (
  records,
  { olderThanDays = 90, keepNewest = 5, protectedPatterns = ['latest', 'stable'], deleteCosignTags = false } = {},
  now = new Date(),
  unverifiedRepositories = [],
) => {
  const unverified = new Set(unverifiedRepositories);
  // A NaN here made every comparison below false, so nothing counted as recent
  // or kept and everything became a candidate. Refuse the whole plan instead.
  const validPolicy = Number.isFinite(olderThanDays) && Number.isFinite(keepNewest);
  const cutoff = now.getTime() - (validPolicy ? Math.max(0, olderThanDays) : 0) * 86400000;
  const patterns = compilePatterns(protectedPatterns);
  const candidates = [];
  const skipped = [];
  const byRepository = new Map();
  const cosignRecords = new Set();
  records.forEach((record) => {
    if (!validPolicy) {
      skipped.push({ repository: record.repository, tags: [record.tag], reason: 'Invalid retention policy' });
      return;
    }
    if (!deleteCosignTags && COSIGN_TAG_REGEX.test(record.tag)) {
      // Not ranked, but still kept in the repository's records below: an index
      // under a cosign-shaped name still references children that stay protected.
      cosignRecords.add(record);
      skipped.push({
        repository: record.repository,
        digest: record.digest,
        tags: [record.tag],
        reason: `Cosign signature/attestation tag: ${record.tag}`,
      });
    }
    const items = byRepository.get(record.repository) || [];
    items.push(record);
    byRepository.set(record.repository, items);
  });

  byRepository.forEach((repositoryRecords, repository) => {
    // Deleting a manifest removes every tag on it, cosign ones included, so a
    // real tag sharing a digest with a cosign tag is protected, not offered.
    const cosignDigests = new Map();
    repositoryRecords.forEach((record) => {
      if (cosignRecords.has(record) && record.digest) cosignDigests.set(record.digest, record.tag);
    });
    const sorted = repositoryRecords.filter((record) => !cosignRecords.has(record)).sort(byNewest);
    const verdicts = [];
    const referenced = new Map();
    repositoryRecords.forEach((record) => {
      if (!record.isIndex) return;
      const digests = [...(record.references || []), ...(record.platforms || []).map((platform) => platform.digest)];
      digests.forEach((digest) => {
        if (digest && digest !== record.digest && !referenced.has(digest)) referenced.set(digest, record.tag);
      });
    });
    const byDigest = new Map();
    sorted.forEach((record) => {
      const key = record.digest;
      if (!key) {
        skipped.push({ repository, tags: [record.tag], reason: 'Digest unavailable' });
        return;
      }
      const aliases = byDigest.get(key) || [];
      aliases.push(record);
      byDigest.set(key, aliases);
    });
    // Distinct digests, not tags: `1`, `1.0` and `1.0.0` on one image are one
    // image. Map preserves the newest-first insertion order of `sorted`.
    // Digests already protected on their own (an index references them, a pattern
    // matches, or no trustworthy date) must not use up a slot either: a tagged
    // platform child ties with its index and would otherwise displace the release.
    const keptDigests = new Set(
      [...byDigest.entries()]
        .filter(
          ([digest, aliases]) =>
            !referenced.has(digest) &&
            !cosignDigests.has(digest) &&
            !aliases.some((record) => patterns.some((pattern) => pattern.test(record.tag))) &&
            aliases.every((record) => reliableTime(record.created) !== undefined),
        )
        .map(([digest]) => digest)
        .slice(0, Math.max(0, keepNewest)),
    );
    byDigest.forEach((aliases, digest) => {
      const protectedTag = aliases.find((record) => patterns.some((pattern) => pattern.test(record.tag)));
      const newestTag = keptDigests.has(digest) ? aliases[0] : undefined;
      const missingDate = aliases.find((record) => reliableTime(record.created) === undefined);
      const recentTag = aliases.find((record) => reliableTime(record.created) >= cutoff);
      const cosignShared = cosignDigests.get(digest);
      const blocked = cosignShared || protectedTag || newestTag || missingDate || recentTag;
      if (blocked) {
        skipped.push({
          repository,
          digest,
          tags: aliases.map((record) => record.tag),
          reason: cosignShared
            ? `Cosign tag on the same digest: ${cosignShared}`
            : protectedTag
              ? `Protected tag: ${protectedTag.tag}`
              : newestTag
                ? `Kept among newest: ${newestTag.tag}`
                : missingDate
                  ? `No reliable build date: ${missingDate.tag}`
                  : `Newer than cutoff: ${recentTag.tag}`,
        });
        return;
      }
      verdicts.push({
        repository,
        digest,
        tags: aliases.map((record) => record.tag),
        // `aliases` is filled while walking `sorted`, so it keeps that
        // newest-first order and the head is this digest's newest alias.
        // Re-sorting the strings here would compare ISO 8601 lexicographically,
        // which only matches date order when every value shares one precision
        // and offset.
        created: aliases[0].created,
        size: Math.max(...aliases.map((record) => Number(record.size) || 0)),
      });
    });

    /*
     * Deleting a manifest breaks every index that references it, so a digest an
     * index points at is not ours to delete even when its own tag (app:1.0-amd64)
     * is old and unprotected. Every index in the repository counts, kept or
     * candidate: a candidate index is not guaranteed to go (the user can select
     * only the child, or the index's own delete can fail while the child's
     * succeeds), and a child deleted under a surviving index breaks it. A child
     * therefore waits for a later run, once its index is really gone.
     * `references` is the full descendant set, attestations and nested indexes
     * included; `platforms` is unioned in for records that only carry that.
     */
    verdicts.forEach((candidate) => {
      const parent = referenced.get(candidate.digest);
      if (unverified.has(repository)) {
        skipped.push({
          repository,
          digest: candidate.digest,
          tags: candidate.tags,
          reason: 'Repository not fully inspected',
        });
      } else if (parent === undefined) candidates.push(candidate);
      else
        skipped.push({
          repository,
          digest: candidate.digest,
          tags: candidate.tags,
          reason: `Referenced by index ${parent}`,
        });
    });
  });
  return { candidates, skipped, cutoff: new Date(cutoff).toISOString() };
};
