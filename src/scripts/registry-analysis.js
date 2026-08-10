/*
 * An unparseable `created` used to make byNewest return NaN, which is not a
 * consistent comparator: sort() is then free to leave the whole repository in
 * arbitrary order, so "keep the newest N" could retain the wrong N. The record
 * carrying the bad date is blocked from deletion by its own check either way --
 * the damage was to its neighbours. A finite sentinel sorts it last and keeps
 * the ordering total (subtracting two sentinels gives 0, not NaN).
 */
const timeOf = (record) => {
  const time = new Date(record.created ?? 0).getTime();
  return Number.isNaN(time) ? Number.MIN_SAFE_INTEGER : time;
};

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

export const planRetention = (
  records,
  { olderThanDays = 90, keepNewest = 5, protectedPatterns = ['latest', 'stable'] } = {},
  now = new Date(),
) => {
  const cutoff = now.getTime() - Math.max(0, olderThanDays) * 86400000;
  const patterns = compilePatterns(protectedPatterns);
  const candidates = [];
  const skipped = [];
  const byRepository = new Map();
  records.forEach((record) => {
    const items = byRepository.get(record.repository) || [];
    items.push(record);
    byRepository.set(record.repository, items);
  });

  byRepository.forEach((repositoryRecords, repository) => {
    const sorted = [...repositoryRecords].sort(byNewest);
    const keptTags = new Set(sorted.slice(0, Math.max(0, keepNewest)).map((record) => record.tag));
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
    byDigest.forEach((aliases, digest) => {
      const protectedTag = aliases.find((record) => patterns.some((pattern) => pattern.test(record.tag)));
      const newestTag = aliases.find((record) => keptTags.has(record.tag));
      const missingDate = aliases.find((record) => !record.created || Number.isNaN(new Date(record.created).getTime()));
      const recentTag = aliases.find((record) => new Date(record.created).getTime() >= cutoff);
      const blocked = protectedTag || newestTag || missingDate || recentTag;
      if (blocked) {
        skipped.push({
          repository,
          digest,
          tags: aliases.map((record) => record.tag),
          reason: protectedTag
            ? `Protected tag: ${protectedTag.tag}`
            : newestTag
              ? `Kept among newest: ${newestTag.tag}`
              : missingDate
                ? `Creation date unavailable: ${missingDate.tag}`
                : `Newer than cutoff: ${recentTag.tag}`,
        });
        return;
      }
      candidates.push({
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
  });
  return { candidates, skipped, cutoff: new Date(cutoff).toISOString() };
};
