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

import { getFromCache, setCache } from './cache-request.js';

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
    } else if (window.crypto && window.TextEncoder) {
      crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(this.oReq.responseText || this.cache?.responseText))
        .then((buffer) => {
          cb(
            'sha256:' +
              Array.from(new Uint8Array(buffer))
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join(''),
          );
        });
    } else {
      // IE and old Edge
      // simply do not call the callback and skip the setup downstream
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
            self.onAuthentication(tokenAuth, (bearer) => {
              const req = new XMLHttpRequest();
              req._url = self._url;
              req.open(self._method, self._url);
              for (const key in self._events) {
                req.addEventListener(key, self._events[key]);
              }
              for (const key in self._headers) {
                req.setRequestHeader(key, self._headers[key]);
              }
              if (bearer?.token) {
                req.setRequestHeader('Authorization', `Bearer ${bearer.token}`);
              } else if (bearer?.access_token) {
                req.setRequestHeader('Authorization', `Bearer ${bearer.access_token}`);
              } else {
                req.withCredentials = true;
              }
              req.hasHeader = hasHeader;
              req.getErrorMessage = getErrorMessage;
              self.oReq = req;
              req.send();
            });
          } else {
            (this.status === 200 || this.status === 202) &&
              !self.withCredentials &&
              setCache(
                self._method,
                self._url,
                {
                  responseText: this.responseText,
                  dockerContentdigest: this.getResponseHeader('Docker-Content-Digest'),
                },
                Date.now(),
                self.cacheVariant(),
              );
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
    if (!this.noCache && !this.withCredentials) {
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

const AUTHENTICATE_HEADER_REGEX = /Bearer realm="(?<realm>[^"]+)",service="(?<service>[^"]+)",scope="(?<scope>[^"]+)"/;

const parseAuthenticateHeader = (header) => {
  const exec = AUTHENTICATE_HEADER_REGEX.exec(header);
  return exec?.groups;
};
