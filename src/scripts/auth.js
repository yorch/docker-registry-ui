/*
 * Copyright (C) 2016-2023 Jones Magloire @Joxit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const trimSlashes = (url) => String(url ?? '').replace(/\/+$/, '');

// A registry is trusted when the operator or the user already chose it: the
// REGISTRY_URL prop, a default registry, or an entry in the saved registry
// list. A registry that only arrived through `?url=` is not, because anyone can
// hand a victim such a link.
export const isTrustedRegistry = (registryUrl, trustedRegistries = []) => {
  const url = trimSlashes(registryUrl);
  return Boolean(url) && trustedRegistries.some((trusted) => trimSlashes(trusted) === url);
};

// Trust is decided from the request that got the 401, never from what the UI
// shows now: a held-open request can be answered after the user switched
// registries. A request is trusted when its origin is the origin of a trusted
// registry.
const isTrustedRequest = (requestUrl, trustedRegistries = []) => {
  const request = parseHttpUrl(requestUrl);
  return Boolean(request) && trustedRegistries.some((trusted) => parseHttpUrl(trusted)?.origin === request.origin);
};

const parseHttpUrl = (value, base) => {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch (_e) {
    return undefined;
  }
};

// A realm is an absolute http(s) URL or a path starting with `/`, resolved
// against the request URL. It is followed only when it shares the request's
// origin or the request went to a trusted registry. Following any other realm
// hands the user's credentials to whoever the registry names, then replays the
// minted token against that same registry.
const resolveRealm = (realm, requestUrl) => {
  if (typeof realm !== 'string' || !(/^https?:\/\//i.test(realm) || realm.startsWith('/'))) {
    return undefined;
  }
  return parseHttpUrl(realm, parseHttpUrl(requestUrl)?.href);
};

export const isRealmAllowed = (realm, requestUrl, trusted) => {
  const realmUrl = resolveRealm(realm, requestUrl);
  if (!realmUrl) {
    return false;
  }
  return Boolean(trusted) || parseHttpUrl(requestUrl)?.origin === realmUrl.origin;
};

export const buildTokenUrl = ({ realm, service, scope }, requestUrl) => {
  const url = resolveRealm(realm, requestUrl) ?? new URL(realm);
  url.searchParams.set('service', service);
  url.searchParams.append('scope', scope);
  return url.toString();
};

const TOKEN_TIMEOUT_MS = 30000;

// `registryUrl` is the URL of the request that got the 401.
// Always ends in exactly one `onAuthenticated` call, with a bearer only when
// one was obtained. The caller retries the original request either way, and a
// request that never settles would hold its request-pool slot forever.
export const requestBearer = (opts, { registryUrl, trusted, notify }, onAuthenticated) => {
  if (!(opts?.realm && opts.service && opts.scope)) {
    onAuthenticated();
    return;
  }
  if (!isRealmAllowed(opts.realm, registryUrl, trusted)) {
    notify?.(`Refused to log in: the token server \`${opts.realm}\` is not on the registry's origin.`, true);
    onAuthenticated();
    return;
  }
  let settled = false;
  const settle = (bearer, error) => {
    if (settled) {
      return;
    }
    settled = true;
    if (error) {
      notify?.(`Failed to log in: ${error}`, true);
    }
    onAuthenticated(bearer);
  };
  const req = new XMLHttpRequest();
  req.addEventListener('error', () => settle(undefined, 'the token request failed'));
  req.addEventListener('loadend', () => {
    if (settled) {
      return;
    }
    if (req.status < 200 || req.status >= 300) {
      return settle(undefined, `the token server answered ${req.status}`);
    }
    // Parse inside the try, settle outside it: a throw from the caller's
    // continuation must not be mistaken for a parse error and swallowed.
    let bearer;
    try {
      bearer = JSON.parse(req.responseText);
    } catch (e) {
      return settle(undefined, e.message);
    }
    settle(bearer);
  });
  req.withCredentials = true;
  try {
    req.open('GET', buildTokenUrl(opts, registryUrl));
    // loadend also fires on timeout, so a silent token server cannot hold the
    // caller (and its request-pool slot) forever.
    req.timeout = TOKEN_TIMEOUT_MS;
    req.send();
  } catch (e) {
    settle(undefined, e.message);
  }
};

export const authenticateRequest = (opts, requestUrl, trustedRegistries, notify, onAuthenticated) =>
  requestBearer(
    opts,
    { registryUrl: requestUrl, trusted: isTrustedRequest(requestUrl, trustedRegistries), notify },
    onAuthenticated,
  );
