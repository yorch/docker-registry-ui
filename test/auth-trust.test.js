import assert from 'node:assert';
import { authenticateRequest, isRealmAllowed } from '../src/scripts/auth.js';
import { Http } from '../src/scripts/http.js';
import { RequestPool } from '../src/scripts/request-pool.js';

const TRUSTED = 'https://registry.corp.example';
const VICTIM_AUTH = 'https://sso.corp.example/token';
const EVIL = 'https://evil.example.net';

class FakeXHR {
  static instances = [];
  static strict = false;
  constructor() {
    this.listeners = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    FakeXHR.instances.push(this);
  }
  addEventListener(n, f) {
    this.listeners[n] = f;
  }
  open(m, u) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k, v) {
    if (FakeXHR.strict && /[\r\n\0]/.test(v)) {
      throw new SyntaxError(`'${v}' is not a valid HTTP header field value`);
    }
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
  send() {
    this.sent = true;
  }
  respond(status, body = '', respHeaders = {}) {
    Object.assign(this, { status, responseText: body, respHeaders });
    this.listeners.load?.call(this);
    this.listeners.loadend?.call(this);
  }
}

// Hooks must live inside each describe: a root-level beforeEach would swap in
// the fake XMLHttpRequest for every test file in the run.
const realXHR = globalThis.XMLHttpRequest;
const useFakeXhr = () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    FakeXHR.strict = false;
    globalThis.XMLHttpRequest = FakeXHR;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realXHR;
  });
};

const challenge = (realm, scope = 'registry:catalog:*') => ({
  'www-authenticate': `Bearer realm="${realm}",service="corp",scope="${scope}"`,
});
const makeHttp = (trusted, notes = []) =>
  new Http({
    onAuthentication: (opts, cb, requestUrl) =>
      authenticateRequest(opts, requestUrl, trusted, (m) => notes.push(m), cb),
  });

describe('trust is decided from the request URL (ADV-1)', () => {
  useFakeXhr();
  it('refuses a victim realm named by an untrusted origin, even if the UI has since switched to a trusted registry', () => {
    const notes = [];
    const trusted = [TRUSTED]; // the UI state is irrelevant now: only the list is consulted
    const http = makeHttp(trusted, notes);
    http.addEventListener('loadend', () => {});
    http.open('GET', `${EVIL}/v2/team/app/tags/list`);
    http.send();
    FakeXHR.instances[0].respond(401, '', challenge(VICTIM_AUTH, 'repository:*:*'));
    assert.ok(
      FakeXHR.instances.every((x) => !x.url.startsWith('https://sso.corp.example')),
      'no token request to the victim SSO',
    );
    assert.ok(
      FakeXHR.instances.every((x) => !x.headers.Authorization),
      'no bearer sent anywhere',
    );
    assert.equal(notes.length, 1);
  });

  it('still follows a cross-origin realm for a request that went to a trusted registry', () => {
    const http = makeHttp([TRUSTED]);
    http.addEventListener('loadend', () => {});
    http.open('GET', `${TRUSTED}/v2/_catalog`);
    http.send();
    FakeXHR.instances[0].respond(401, '', challenge(VICTIM_AUTH));
    FakeXHR.instances[1].respond(200, '{"token":"T"}');
    assert.equal(FakeXHR.instances[2].url, `${TRUSTED}/v2/_catalog`);
    assert.equal(FakeXHR.instances[2].headers.Authorization, 'Bearer T');
  });

  it('never replays a minted bearer to an origin other than the one that answered 401', () => {
    // Same-origin realm so the token is minted, but the 401 came from a redirect target.
    const http = makeHttp([TRUSTED]);
    http.addEventListener('loadend', () => {});
    http.open('GET', `${TRUSTED}/v2/_catalog`);
    http.send();
    FakeXHR.instances[0].responseURL = `${EVIL}/v2/_catalog`;
    FakeXHR.instances[0].respond(401, '', challenge(`${TRUSTED}/token`));
    FakeXHR.instances[1]?.respond(200, '{"token":"T"}');
    assert.ok(
      FakeXHR.instances.every((x) => !x.headers.Authorization),
      'bearer not sent',
    );
  });
});

describe('a throwing replay settles the original request (ADV-2)', () => {
  useFakeXhr();
  it('CR/LF token: original request settles with its 401 and the pool slot is released', () => {
    FakeXHR.strict = true;
    const pool = new RequestPool(1);
    const http = makeHttp([TRUSTED]);
    let settled = 0;
    let status;
    pool.submit((done) => {
      http.addEventListener('loadend', function () {
        settled++;
        status = this.status;
        done();
      });
      http.open('GET', `${TRUSTED}/v2/_catalog`);
      http.send();
    });
    FakeXHR.instances[0].respond(401, '', challenge(`${TRUSTED}/token`));
    FakeXHR.instances[1].respond(200, JSON.stringify({ token: 'a\nb' }));
    assert.equal(settled, 1);
    assert.equal(status, 401);
    assert.equal(pool.active, 0);
  });

  it('a token server that never answers settles after the XHR timeout', () => {
    const http = makeHttp([TRUSTED]);
    http.addEventListener('loadend', () => {});
    http.open('GET', `${TRUSTED}/v2/_catalog`);
    http.send();
    FakeXHR.instances[0].respond(401, '', challenge(`${TRUSTED}/token`));
    const tokenReq = FakeXHR.instances[1];
    assert.equal(tokenReq.timeout, 30000);
    tokenReq.respond(0); // what loadend looks like after a timeout
    assert.ok(FakeXHR.instances[2].sent, 'original request retried');
    assert.equal(FakeXHR.instances[2].headers.Authorization, undefined);
  });
});

describe('legitimate deployments (ADV-3)', () => {
  useFakeXhr();
  it('proxy mode: the UI own origin is trusted when it was not taken from ?url=', () => {
    const http = makeHttp(['https://ui.corp.example']);
    http.addEventListener('loadend', () => {});
    http.open('GET', 'https://ui.corp.example/v2/_catalog');
    http.send();
    FakeXHR.instances[0].respond(401, '', challenge('https://gitlab.corp.example/jwt/auth'));
    assert.match(FakeXHR.instances[1].url, /^https:\/\/gitlab\.corp\.example\/jwt\/auth/);
  });

  it('a relative realm is resolved against the request URL', () => {
    const http = makeHttp([]);
    http.addEventListener('loadend', () => {});
    http.open('GET', `${EVIL}/v2/_catalog`);
    http.send();
    FakeXHR.instances[0].respond(401, '', challenge('/auth/token'));
    assert.match(FakeXHR.instances[1].url, /^https:\/\/evil\.example\.net\/auth\/token\?/);
  });

  it('a relative realm is allowed for a trusted registry; scheme-relative to another origin follows the trust rule', () => {
    assert.equal(isRealmAllowed('/auth/token', TRUSTED, true), true);
    assert.equal(isRealmAllowed('/auth/token', TRUSTED, false), true);
    assert.equal(isRealmAllowed('//sso.corp.example/token', TRUSTED, false), false);
    assert.equal(isRealmAllowed('not a url', TRUSTED, true), false);
  });
});
