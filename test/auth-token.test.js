import assert from 'node:assert';
import { buildTokenUrl, isRealmAllowed, isTrustedRegistry, requestBearer } from '../src/scripts/auth.js';
import { Http } from '../src/scripts/http.js';
import { RequestPool } from '../src/scripts/request-pool.js';

const REGISTRY = 'https://registry.example.com';
const REALM = 'https://auth.example.com/token';

describe('isRealmAllowed', () => {
  it('allows a realm on the registry origin', () => {
    assert.equal(isRealmAllowed(`${REGISTRY}/auth/token`, REGISTRY, false), true);
  });
  it('allows a cross-origin realm for a trusted registry', () => {
    assert.equal(isRealmAllowed(REALM, REGISTRY, true), true);
  });
  it('refuses a cross-origin realm for an untrusted registry', () => {
    assert.equal(isRealmAllowed('https://evil.example.net/token', REGISTRY, false), false);
    assert.equal(isRealmAllowed('http://registry.example.com/token', REGISTRY, false), false);
  });
  it('refuses a malformed realm, even for a trusted registry', () => {
    assert.equal(isRealmAllowed('not a url', REGISTRY, true), false);
    assert.equal(isRealmAllowed('', REGISTRY, true), false);
  });
  it('refuses a non-http(s) realm', () => {
    assert.equal(isRealmAllowed('javascript:alert(1)', REGISTRY, true), false);
    assert.equal(isRealmAllowed('ftp://registry.example.com/token', REGISTRY, false), false);
  });
});

describe('isTrustedRegistry', () => {
  it('matches configured registries ignoring trailing slashes', () => {
    assert.equal(isTrustedRegistry(`${REGISTRY}/`, [REGISTRY]), true);
    assert.equal(isTrustedRegistry(REGISTRY, [`${REGISTRY}/`]), true);
  });
  it('does not trust a registry that is not configured', () => {
    assert.equal(isTrustedRegistry('https://evil.example.net', [REGISTRY]), false);
    assert.equal(isTrustedRegistry('https://evil.example.net', []), false);
    assert.equal(isTrustedRegistry('', ['']), false);
  });
});

describe('buildTokenUrl', () => {
  it('encodes service and scope', () => {
    const url = new URL(
      buildTokenUrl({ realm: `${REALM}?x=1`, service: 'my reg&x', scope: 'repository:a/b:pull,push' }),
    );
    assert.equal(url.searchParams.get('x'), '1');
    assert.equal(url.searchParams.get('service'), 'my reg&x');
    assert.deepEqual(url.searchParams.getAll('scope'), ['repository:a/b:pull,push']);
  });
});

// A minimal XHR: tests drive the response by hand.
class FakeXHR {
  static instances = [];
  constructor() {
    this.listeners = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    FakeXHR.instances.push(this);
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  getAllResponseHeaders() {
    return Object.entries(this.respHeaders || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }
  getResponseHeader(k) {
    return this.respHeaders?.[k.toLowerCase()] ?? null;
  }
  send() {}
  respond(status, body = '', respHeaders = {}) {
    Object.assign(this, { status, responseText: body, respHeaders });
    this.listeners.load?.call(this);
    this.listeners.loadend?.call(this);
  }
  fail() {
    this.listeners.error?.call(this);
    this.listeners.loadend?.call(this);
  }
}

describe('token request failure handling', () => {
  const realXHR = globalThis.XMLHttpRequest;
  const opts = { realm: REALM, service: 'reg', scope: 'repository:a:pull' };
  beforeEach(() => {
    FakeXHR.instances = [];
    globalThis.XMLHttpRequest = FakeXHR;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realXHR;
  });

  const run = (finish) => {
    const calls = [];
    const notes = [];
    requestBearer(opts, { registryUrl: REGISTRY, trusted: true, notify: (m, e) => notes.push([m, e]) }, (b) =>
      calls.push(b),
    );
    finish(FakeXHR.instances[0]);
    return { calls, notes };
  };

  it('passes the bearer on success', () => {
    const { calls } = run((x) => x.respond(200, '{"token":"t"}'));
    assert.deepEqual(calls, [{ token: 't' }]);
  });
  it('settles without a bearer on a network error, once', () => {
    const { calls, notes } = run((x) => x.fail());
    assert.deepEqual(calls, [undefined]);
    assert.equal(notes.length, 1);
  });
  it('settles without a bearer on a non-2xx answer', () => {
    assert.deepEqual(run((x) => x.respond(500, 'oops')).calls, [undefined]);
  });
  it('settles without a bearer on a non-JSON answer', () => {
    assert.deepEqual(run((x) => x.respond(200, '<html>')).calls, [undefined]);
  });
  it('does not contact an untrusted cross-origin realm, but still settles', () => {
    const calls = [];
    const notes = [];
    requestBearer(opts, { registryUrl: REGISTRY, trusted: false, notify: (m, e) => notes.push([m, e]) }, (b) =>
      calls.push(b),
    );
    assert.equal(FakeXHR.instances.length, 0);
    assert.deepEqual(calls, [undefined]);
    assert.equal(notes[0][1], true);
  });

  it('releases the request pool slot when the token request fails', () => {
    const pool = new RequestPool(1);
    const http = new Http({
      onAuthentication: (o, cb) => requestBearer(o, { registryUrl: REGISTRY, trusted: true }, cb),
    });
    let settled = 0;
    pool.submit((done) => {
      http.addEventListener('loadend', () => {
        settled++;
        done();
      });
      http.open('GET', `${REGISTRY}/v2/_catalog`);
      http.send();
    });
    assert.equal(pool.active, 1);
    const [first] = FakeXHR.instances;
    first.respond(401, '', {
      'www-authenticate': `Bearer realm="${REALM}",service="reg",scope="repository:a:pull"`,
    });
    FakeXHR.instances[1].fail(); // the token request
    FakeXHR.instances[2].respond(401); // the retry fails normally
    assert.equal(settled, 1);
    assert.equal(pool.active, 0);
  });
});
