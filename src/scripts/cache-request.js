/*
 * Response cache backed by sessionStorage.
 *
 * Two classes of URL are cached, and they are keyed differently on purpose:
 *
 *   immutable  `<blobs|manifests>/sha256:<hex>` is content addressed, so the
 *              same digest is the same bytes on any registry. Keyed on the
 *              digest alone so registries share entries, and never expired.
 *
 *   mutable    `/v2/<name>/tags/list` and tag-addressed manifests change when
 *              somebody pushes. Keyed on the full URL, because the same path
 *              on two registries is two different things, and expired quickly.
 */

const NAMESPACE = 'drui:v1:';
const IMMUTABLE_REGEX = /(blobs|manifests)\/sha256:[a-f0-9]+$/;
const TAGS_LIST_REGEX = /\/v2\/.+\/tags\/list(\?.*)?$/;
const TAG_MANIFEST_REGEX = /\/v2\/.+\/manifests\/[^/]+$/;

export const MUTABLE_TTL_MS = 30000;
export const MAX_CACHE_ENTRIES = 200;
export const MAX_CACHE_BYTES = 4 * 1024 * 1024;

// Returns the storage key and time-to-live for a request, or undefined when the
// request is not cacheable at all.
const cacheEntryFor = (method, url, variant = '') => {
  if (method !== 'GET' || !url) {
    return undefined;
  }
  const immutable = IMMUTABLE_REGEX.exec(url);
  if (immutable) {
    return { key: `${NAMESPACE}sha:${immutable[0]}:v:${encodeURIComponent(variant)}`, ttl: null };
  }
  if (TAGS_LIST_REGEX.test(url) || TAG_MANIFEST_REGEX.test(url)) {
    return { key: `${NAMESPACE}url:${url}:v:${encodeURIComponent(variant)}`, ttl: MUTABLE_TTL_MS };
  }
  return undefined;
};

// Only ever touch our own keys: the sweep below deletes, and this page shares
// sessionStorage with whatever else is on the origin.
const ourKeys = () => {
  const keys = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(NAMESPACE)) {
        keys.push(key);
      }
    }
  } catch (e) {}
  return keys;
};

const remove = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch (e) {}
};

const sweepExpired = (now) => {
  ourKeys().forEach((key) => {
    try {
      const envelope = JSON.parse(sessionStorage.getItem(key));
      if (envelope && envelope.e != null && now > envelope.e) {
        remove(key);
      }
    } catch (e) {
      remove(key);
    }
  });
};

const enforceBudget = (incomingKey, incomingValue) => {
  if (incomingKey.length + incomingValue.length > MAX_CACHE_BYTES) {
    return false;
  }
  const entries = ourKeys()
    .filter((key) => key !== incomingKey)
    .map((key) => {
      try {
        const value = sessionStorage.getItem(key) || '';
        const envelope = JSON.parse(value);
        return { key, bytes: key.length + value.length, accessed: envelope?.a || 0 };
      } catch (_error) {
        remove(key);
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.accessed - right.accessed);
  let bytes = incomingKey.length + incomingValue.length + entries.reduce((total, entry) => total + entry.bytes, 0);
  let count = entries.length + 1;
  while (entries.length && (count > MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES)) {
    const oldest = entries.shift();
    remove(oldest.key);
    bytes -= oldest.bytes;
    count--;
  }
  return count <= MAX_CACHE_ENTRIES && bytes <= MAX_CACHE_BYTES;
};

export const getFromCache = (method, url, now = Date.now(), variant = '') => {
  const entry = cacheEntryFor(method, url, variant);
  if (!entry) {
    return undefined;
  }
  try {
    const raw = sessionStorage.getItem(entry.key);
    if (!raw) {
      return undefined;
    }
    const envelope = JSON.parse(raw);
    if (!envelope || typeof envelope !== 'object') {
      remove(entry.key);
      return undefined;
    }
    if (envelope.e != null && now > envelope.e) {
      remove(entry.key);
      return undefined;
    }
    envelope.a = now;
    try {
      sessionStorage.setItem(entry.key, JSON.stringify(envelope));
    } catch (_error) {}
    return { responseText: envelope.r, dockerContentdigest: envelope.d };
  } catch (e) {
    remove(entry.key);
    return undefined;
  }
};

export const setCache = (method, url, { responseText, dockerContentdigest }, now = Date.now(), variant = '') => {
  const entry = cacheEntryFor(method, url, variant);
  if (!entry) {
    return;
  }
  const envelope = JSON.stringify({
    r: responseText,
    d: dockerContentdigest === undefined ? null : dockerContentdigest,
    e: entry.ttl === null ? null : now + entry.ttl,
    a: now,
  });
  try {
    sweepExpired(now);
    if (!enforceBudget(entry.key, envelope)) {
      return;
    }
    sessionStorage.setItem(entry.key, envelope);
  } catch (e) {
    // Out of room. Drop what has already expired and try once more; if it still
    // does not fit, run without caching this response.
    sweepExpired(now);
    try {
      sessionStorage.setItem(entry.key, envelope);
    } catch (e2) {}
  }
};

// Deleting an image makes that repository's tag list wrong straight away, and
// the list is refetched a second later. A surviving entry would serve the
// deleted tag back and read as a delete that silently failed.
export const invalidateRepository = (registryUrl, name) => {
  const marker = `${registryUrl}/v2/${name}/`;
  ourKeys().forEach((key) => {
    if (key.startsWith(`${NAMESPACE}url:`) && key.includes(marker)) {
      remove(key);
    }
  });
};

export const invalidateRegistry = (registryUrl) => {
  const marker = `${NAMESPACE}url:${registryUrl}/v2/`;
  ourKeys().forEach((key) => {
    if (key.startsWith(marker)) {
      remove(key);
    }
  });
};
