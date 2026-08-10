const LOCAL_STORAGE_KEY = 'registryServer';

export const DEFAULT_APP_NAME = 'Registry Explorer';

/*
 * Unset arrives as an empty string rather than undefined: the container
 * entrypoint substitutes every `${VAR}` placeholder in index.html whether the
 * variable is set or not, so "" is the ordinary case rather than an edge one.
 */
export const resolveAppName = (appName) => (appName || '').trim() || DEFAULT_APP_NAME;

// A value that has not arrived yet reads differently from one that could not be
// fetched. `undefined` is still in flight, `null` failed -- the same rule the
// catalog tag-count badge follows.
export const PENDING_LABEL = '…';
export const UNAVAILABLE_LABEL = '—';

export function bytesToSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  // The Number() coercion below is deliberate: `bytes` is a size read straight
  // out of a config blob, so a non-numeric string has to land on the pending
  // label rather than fall through and render "NaN undefined". A bare
  // Number.isNaN would only catch an actual NaN.
  if (bytes === null) {
    return UNAVAILABLE_LABEL;
  } else if (bytes == undefined || Number.isNaN(Number(bytes))) {
    return PENDING_LABEL;
  } else if (bytes === 0) {
    return '0 Byte';
  }
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  const number = bytes / 1024 ** i;
  if (number < 10) {
    const decimal = (bytes - Math.floor(number) * 1024 ** i) / 1024 ** i;
    return `${Math.floor(number)}.${Math.floor(decimal * 10)} ${sizes[i]}`;
  }
  return `${Math.ceil(number)} ${sizes[i]}`;
}

export function dateFormat(date) {
  if (date === undefined) {
    return '';
  }
  const labels = [
    'a second',
    'seconds',
    'a minute',
    'minutes',
    'an hour',
    'hours',
    'a day',
    'days',
    'a month',
    'months',
    'a year',
    'years',
  ];
  const maxSeconds = [1, 60, 3600, 86400, 2592000, 31104000, Infinity];
  const diff = (Date.now() - date) / 1000;
  for (var i = 0; i < maxSeconds.length - 1; i++) {
    if (maxSeconds[i] * 2 >= diff) {
      return labels[i * 2];
    } else if (maxSeconds[i + 1] > diff) {
      return `${Math.floor(diff / maxSeconds[i])} ${labels[i * 2 + 1]}`;
    }
  }
}

export function getHistoryIcon(attribute) {
  switch (attribute) {
    case 'architecture':
      return 'memory';
    case 'created':
      return 'event';
    case 'docker_version':
      return '';
    case 'os':
      return 'developer_board';
    case 'Cmd':
      return 'launch';
    case 'Entrypoint':
      return 'input';
    case 'Env':
      return 'notes';
    case 'Labels':
      return 'label';
    case 'User':
      return 'face';
    case 'Volumes':
      return 'storage';
    case 'WorkingDir':
      return 'home';
    case 'author':
      return 'account_circle';
    case 'id':
    case 'digest':
      return 'settings_ethernet';
    case 'created_by':
      return 'build';
    case 'size':
      return 'get_app';
    case 'ExposedPorts':
      return 'router';
    case 'comment':
      return 'chat';
    case 'home':
      return 'home';
    case 'sources':
      return 'link';
    case 'keywords':
      return 'receipt';
    case 'name':
      return 'abc';
    case 'kubeVersion':
    case 'appVersion':
      return '123';
    default:
      if (attribute.startsWith('custom-label-')) {
        return 'label';
      }
      return '';
  }
}

export function getPage(elts, page, limit) {
  if (!limit) {
    limit = 100;
  }
  if (!elts) {
    return [];
  }
  return elts.slice((page - 1) * limit, limit * page);
}

export function getNumPages(elts, limit) {
  if (!limit) {
    limit = 100;
  }
  if (!elts) {
    return 0;
  }
  return Math.max(1, Math.ceil(elts.length / limit));
}

export function getPageLabels(page, nPages) {
  var pageLabels = [];
  var maxItems = 10;
  if (nPages === 1) {
    return pageLabels;
  }
  if (page !== 1 && nPages >= maxItems) {
    pageLabels.push({ 'icon': 'first_page', page: 1 });
    pageLabels.push({ 'icon': 'chevron_left', page: page - 1 });
  }
  var start = Math.round(Math.max(1, Math.min(page - maxItems / 2, nPages - maxItems + 1)));
  for (var i = start; i < Math.min(nPages + 1, start + maxItems); i++) {
    pageLabels.push({
      page: i,
      current: i === page,
      'space-left': page === 1 && nPages > maxItems,
      'space-right': page === nPages && nPages > maxItems,
    });
  }
  if (page !== nPages && nPages >= maxItems) {
    pageLabels.push({ 'icon': 'chevron_right', page: page + 1 });
    pageLabels.push({ 'icon': 'last_page', page: nPages });
  }
  return pageLabels;
}

export function stripHttps(url) {
  if (!url) {
    return '';
  }
  return url.replace(/^https?:\/\//, '');
}

export function isDigit(char) {
  return char >= '0' && char <= '9';
}

export const ERROR_CAN_NOT_READ_CONTENT_DIGEST = {
  message:
    'Access on registry response was blocked. Try adding the header ' +
    '`Access-Control-Expose-Headers: Docker-Content-Digest`' +
    ' to your proxy or registry: ' +
    'https://docs.docker.com/registry/configuration/#http',
  isError: true,
};

export function getRegistryServers(i) {
  // Called either with an index or with no argument at all. The global isNaN
  // this replaced coerced undefined to NaN to tell those apart; Number.isNaN on
  // its own reports false for undefined, which would index the array with it.
  const wantsSingle = !Number.isNaN(Number(i));
  try {
    const res = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY));
    if (Array.isArray(res)) {
      return wantsSingle ? res[i] : res.map((url) => url.trim().replace(/\/*$/, ''));
    }
  } catch (_e) {}
  return wantsSingle ? '' : [];
}

export function setRegistryServers(registries) {
  if (typeof registries === 'string') {
    registries = registries.split(',');
  } else if (!Array.isArray(registries)) {
    throw new Error('setRegistries must be called with string or array parameter');
  }
  registries = registries.map((registry) => registry.replace(/\/*$/, ''));
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(registries));
}

export function addRegistryServers(registry) {
  const url = registry.trim().replace(/\/*$/, '');
  const registryServer = getRegistryServers().filter((e) => e !== url);
  setRegistryServers([url].concat(registryServer));
  return url;
}

export function removeRegistryServers(registry) {
  const registryServers = getRegistryServers().filter((e) => e !== registry);
  setRegistryServers(registryServers);
}

export function encodeURI(url) {
  if (!url) {
    return;
  }
  return url.indexOf('&') < 0 ? window.encodeURIComponent(url) : btoa(url);
}

export function decodeURI(url) {
  if (!url) {
    return;
  }
  return url.startsWith('http') ? window.decodeURIComponent(url) : atob(url);
}

export function truthy(value) {
  return value === true || value === 'true';
}

/**
 * only is false if explicitly set to boolean false or string 'false'.
 * defaults to true in any other case, e.g. if empty.
 *
 * @param {string|boolean} value the input value to check
 * @returns {boolean} false if explicity set, true otherwise
 */
export function falsy(value) {
  return value !== false && value !== 'false';
}

export function stringToArray(value) {
  return value && typeof value === 'string' ? value.split(',') : [];
}

const compareNumbers = (a, b) => {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (na > nb) return 1;
  if (nb > na) return -1;
  // Both are parseInt results, so they are numbers and need no coercion.
  if (!Number.isNaN(na) && Number.isNaN(nb)) return 1;
  if (Number.isNaN(na) && !Number.isNaN(nb)) return -1;
  return 0;
};

export function isNewestVersion(current = '0.0.0', release = '0.0.0') {
  if (current === release) {
    return true;
  }
  current = current.split('.');
  release = release.split('.');
  const isDev = current[2].indexOf('-') >= 0;
  const major = compareNumbers(current[0], release[0]);
  const minor = compareNumbers(current[1], release[1]);
  const patch = compareNumbers(current[2], release[2]);
  if (!isDev && (major > 0 || (major === 0 && minor > 0) || (major === 0 && minor === 0 && patch >= 0))) {
    return true;
  } else if (isDev && (major > 0 || (major === 0 && minor > 0))) {
    return true;
  }
  return false;
}

export function parseJSON(json) {
  if (!json) {
    return;
  }
  try {
    return JSON.parse(json);
  } catch (_e) {}
}
