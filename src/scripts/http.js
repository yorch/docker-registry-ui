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

import { addressedDigest, getFromCache, setCache } from './cache-request.js';

export class Http {
  constructor(opts) {
    this.oReq = new XMLHttpRequest();
    this.oReq.hasHeader = hasHeader;
    this.oReq.getErrorMessage = getErrorMessage;
    this._events = {};
    this._headers = {};
    this.onAuthentication = opts?.onAuthentication;
    this.withCredentials = opts?.withCredentials;
    // Opt out for requests that must see the registry as it is right now. The
    // delete flow reads Docker-Content-Digest from a tag-addressed manifest and
    // then deletes by that digest, so a stale one deletes the wrong manifest.
    this.noCache = Boolean(opts?.noCache);
  }

  getContentDigest(cb) {
    if (this.cache?.dockerContentdigest) {
      cb(this.cache.dockerContentdigest);
    } else if (this.oReq.hasHeader('Docker-Content-Digest')) {
      // Same origin or advanced CORS headers set:
      // 'Access-Control-Expose-Headers: Docker-Content-Digest'
      cb(this.oReq.getResponseHeader('Docker-Content-Digest'));
    } else if (window.crypto?.subtle && window.TextEncoder) {
      // `crypto.subtle` only exists on secure contexts, so plain http:// pages
      // land in the else branch below.
      const text = this.oReq.responseText || this.cache?.responseText;
      if (typeof text !== 'string') {
        cb(undefined);
        return;
      }
      window.crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(text))
        .then((buffer) => {
          cb(
            'sha256:' +
              Array.from(new Uint8Array(buffer))
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join(''),
          );
        })
        .catch(() => cb(undefined));
    } else {
      // Insecure context or an old browser: no digest, and callers take their
      // "no digest" path instead of waiting on a callback that never fires.
      cb(undefined);
    }
  }

  addEventListener(e, f) {
    this._events[e] = f;
    const self = this;
    switch (e) {
      case 'loadend': {
        self.oReq.addEventListener('loadend', function () {
          const tokenAuth =
            this.hasHeader('www-authenticate') && parseAuthenticateHeader(this.getResponseHeader('www-authenticate'));
          if (this.status === 401 && (!this.withCredentials || tokenAuth)) {
            const origin = (url) => {
              try {
                return new URL(url).origin;
              } catch (_e) {
                return undefined;
              }
            };
            const requestUrl = self._url;
            self.onAuthentication(
              tokenAuth,
              (bearer) => {
                const token = bearer?.token || bearer?.access_token;
                // The bearer was minted for the origin that answered 401. Never
                // send it anywhere else (a redirect, a re-opened Http).
                const answeredFrom = origin(this.responseURL || requestUrl);
                if (token && (answeredFrom !== origin(requestUrl) || origin(self._url) !== origin(requestUrl))) {
                  f.bind(this)();
                  return;
                }
                const previous = self.oReq;
                try {
                  const req = new XMLHttpRequest();
                  req._url = self._url;
                  req.open(self._method, self._url);
                  for (const key in self._events) {
                    req.addEventListener(key, self._events[key]);
                  }
                  for (const key in self._headers) {
                    req.setRequestHeader(key, self._headers[key]);
                  }
                  if (token) {
                    req.setRequestHeader('Authorization', `Bearer ${token}`);
                  } else {
                    req.withCredentials = true;
                  }
                  req.hasHeader = hasHeader;
                  req.getErrorMessage = getErrorMessage;
                  self.oReq = req;
                  req.send();
                } catch (_e) {
                  // The replay could not be built or sent (for example a token
                  // that is not a valid header value). Settle the caller with
                  // the original 401 instead of leaving it waiting forever.
                  self.oReq = previous;
                  f.bind(this)();
                }
              },
              requestUrl,
            );
          } else {
            if ((this.status === 200 || this.status === 202) && !self.withCredentials && !self.bypassesCache()) {
              self.storeResponse(this);
            }
            f.bind(this)();
          }
        });
        break;
      }
      case 'load': {
        self.oReq.addEventListener('load', function () {
          if (this.status !== 401) {
            f.bind(this)();
          }
        });
        break;
      }
      default: {
        self.oReq.addEventListener(e, function () {
          f.bind(this)();
        });
        break;
      }
    }
  }

  // Cache-Control on the request is how USE_CONTROL_CACHE_HEADER asks for fresh
  // data. The browser honours it, but this cache sits in front of the browser.
  bypassesCache() {
    const control = this._headers['Cache-Control'] || this._headers['cache-control'] || '';
    return this.noCache || /no-(store|cache)/i.test(control);
  }

  // Digest-addressed entries are shared and never expire, so a body that does
  // not hash to the digest in its own URL (a hostile or broken registry) must
  // not be stored. Without crypto.subtle (plain http) it cannot be checked, so
  // it is not stored either. The caller has already been answered by now.
  storeResponse(response) {
    const entry = {
      responseText: response.responseText,
      dockerContentdigest: response.getResponseHeader('Docker-Content-Digest'),
    };
    const method = this._method;
    const url = this._url;
    const variant = this.cacheVariant();
    const expected = addressedDigest(method, url);
    if (!expected) {
      setCache(method, url, entry, Date.now(), variant);
      return;
    }
    if (!globalThis.crypto?.subtle || !globalThis.TextEncoder || typeof entry.responseText !== 'string') return;
    globalThis.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(entry.responseText))
      .then((buffer) => {
        const actual = `sha256:${Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        // The header is not covered by the hash, so store the digest that was.
        if (actual === expected)
          setCache(method, url, { ...entry, dockerContentdigest: expected }, Date.now(), variant);
      })
      .catch(() => {});
  }

  setRequestHeader(header, value) {
    this.oReq.setRequestHeader(header, value);
    this._headers[header] = value;
  }

  open(m, u) {
    this._method = m;
    this._url = u;
    this.oReq._url = u;
    if (this.withCredentials) {
      this.oReq.withCredentials = true;
    }
    this.oReq.open(m, u);
  }

  send() {
    if (!this.bypassesCache() && !this.withCredentials) {
      const cache = getFromCache(this._method, this._url, Date.now(), this.cacheVariant());
      if (cache?.responseText) {
        this.cache = cache;
        return this.replayFromCache(cache);
      }
    }
    this.oReq.send();
  }

  abort() {
    this.oReq.abort();
  }

  cacheVariant() {
    const accept = this._headers.Accept || this._headers.accept || '';
    return accept ? `accept=${accept}` : '';
  }

  // A real 200 fires `load` and then `loadend`. Replaying only `loadend` works
  // by accident for consumers that happen to parse there, and silently drops
  // the response for anyone parsing in `load` -- tag-list renders an empty
  // table, with no error to explain it.
  replayFromCache(cache) {
    const response = {
      status: 200,
      responseText: cache.responseText,
      withCredentials: this.withCredentials,
      _url: this._url,
      getResponseHeader: (header) =>
        /^docker-content-digest$/i.test(header) ? cache.dockerContentdigest || null : null,
      hasHeader: (header) => /^docker-content-digest$/i.test(header) && Boolean(cache.dockerContentdigest),
      getErrorMessage,
    };
    ['load', 'loadend'].forEach((name) => {
      const handler = this._events[name];
      if (handler) {
        handler.bind(response)();
      }
    });
  }
}

const hasHeader = function (header) {
  return this.getAllResponseHeaders()
    .split('\n')
    .some((h) => new RegExp(`^${header}:`, 'i').test(h));
};

const getErrorMessage = function () {
  if (this._url.match('^http://') && window.location.protocol === 'https:') {
    return { code: 'MIXED_CONTENT', url: this._url };
  } else if (!this._url?.match('^http')) {
    return { code: 'INCORRECT_URL', url: this._url };
  } else if (this.withCredentials && !this.hasHeader('Access-Control-Allow-Credentials')) {
    return (
      "The `Access-Control-Allow-Credentials` header in the response is missing and must be set to `true` when the request's credentials mode is on. Origin `" +
      new URL(this._url).origin +
      '` is therefore not allowed access.'
    );
  }
  return (
    'An error occured: Check your connection and your registry must have `Access-Control-Allow-Origin` header set to `' +
    window.location.origin +
    '`'
  );
};

// Parameters are matched by name: the spec does not fix their order, and a
// registry that lists `scope` before `service` (or adds `error`) must still work.
export const parseAuthenticateHeader = (header) => {
  if (!/^\s*Bearer\s/i.test(header || '')) return undefined;
  const params = {};
  for (const [, key, value] of header.matchAll(/([a-z_]+)="([^"]*)"/gi)) {
    params[key.toLowerCase()] = value;
  }
  const { realm, service, scope } = params;
  return realm && service && scope ? { realm, service, scope } : undefined;
};
