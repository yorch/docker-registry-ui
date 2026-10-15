import assert from 'node:assert';
import { component, register, unregister } from 'riot';
import AppDialog from '../src/components/app-dialog.riot';
import VersionNotification from '../src/components/version-notification.riot';

const LATEST = 'version-notification:latest';
const EXPIRES = 'version-notification:expiration-date';
const DAY = 24 * 60 * 60 * 1000;

class FakeXHR {
  static instances = [];
  constructor() {
    this.listeners = {};
    FakeXHR.instances.push(this);
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  open() {}
  setRequestHeader() {}
  send() {}
  getAllResponseHeaders() {
    return '';
  }
  getResponseHeader() {
    return null;
  }
  fail(name) {
    this.listeners[name]?.call(this);
    this.listeners.loadend?.call(this);
  }
  respond(status, body) {
    this.status = status;
    this.responseText = body;
    this.listeners.load?.call(this);
    this.listeners.loadend?.call(this);
  }
}

describe('version notification', () => {
  const realXHR = globalThis.XMLHttpRequest;
  let notes;

  const mount = (props = {}) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return component(VersionNotification)(root, {
      version: '1.0.0',
      onNotify: (message) => notes.push(message),
      ...props,
    });
  };

  before(() => register('app-dialog', AppDialog));
  after(() => unregister('app-dialog'));
  beforeEach(() => {
    notes = [];
    FakeXHR.instances = [];
    globalThis.XMLHttpRequest = FakeXHR;
    localStorage.clear();
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realXHR;
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('should not announce a release it already knows about on every check', () => {
    const release = JSON.stringify({ tag_name: '2.0.0', html_url: 'https://github.com/yorch/docker-registry-ui' });
    localStorage.setItem(LATEST, release);
    localStorage.setItem(EXPIRES, '1');
    mount();
    FakeXHR.instances[0].respond(200, release);
    assert.deepEqual(notes, []);
  });

  it('should announce a release it has not seen before', () => {
    mount();
    FakeXHR.instances[0].respond(200, JSON.stringify({ tag_name: '2.0.0', html_url: 'https://example.com' }));
    assert.equal(notes.length, 1);
  });

  it('should retry within a day when it says it will', () => {
    mount();
    const before = Date.now();
    FakeXHR.instances[0].respond(500, 'boom');
    assert.match(notes[0], /24 hours/);
    const expires = Number(localStorage.getItem(EXPIRES));
    assert.ok(expires <= before + DAY + 1000, `expiry should be about a day out, was ${(expires - before) / DAY} days`);
  });

  const near = (expires, from, offset) => expires >= from + offset - 1000 && expires <= Date.now() + offset + 1000;

  it('should retry within a day, silently, when there is no response (offline, CORS, air-gapped)', () => {
    mount();
    const before = Date.now();
    FakeXHR.instances[0].status = 0;
    FakeXHR.instances[0].responseText = '';
    FakeXHR.instances[0].fail('error');
    assert.ok(near(Number(localStorage.getItem(EXPIRES)), before, DAY));
    assert.deepEqual(notes, []);
  });

  it('should not postpone the next check when the request is aborted', () => {
    mount();
    FakeXHR.instances[0].status = 0;
    FakeXHR.instances[0].responseText = '';
    FakeXHR.instances[0].fail('abort');
    assert.equal(localStorage.getItem(EXPIRES), null);
    assert.deepEqual(notes, []);
  });

  it('should retry within a day and tell the user after a 401', () => {
    mount();
    const before = Date.now();
    FakeXHR.instances[0].respond(401, 'bad credentials');
    assert.ok(near(Number(localStorage.getItem(EXPIRES)), before, DAY));
    assert.match(notes[0], /24 hours/);
  });

  it('should still tell the user when storage throws', () => {
    mount();
    // The prototype of the page's own localStorage: a bare `Storage` global is
    // only defined on some Node versions, and CI does not have it.
    const storage = Object.getPrototypeOf(localStorage);
    const real = storage.setItem;
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      assert.doesNotThrow(() => FakeXHR.instances[0].respond(500, 'boom'));
    } finally {
      storage.setItem = real;
    }
    assert.match(notes[0], /24 hours/);
  });

  for (const [label, body] of [
    ['is not JSON', '<html>captive portal</html>'],
    ['has no tag_name', JSON.stringify({ message: 'hi' })],
    ['has an empty tag_name', JSON.stringify({ tag_name: '' })],
  ]) {
    it(`should treat a 200 whose body ${label} as a failed check`, () => {
      const instance = mount();
      const before = Date.now();
      assert.doesNotThrow(() => FakeXHR.instances[0].respond(200, body));
      const expires = Number(localStorage.getItem(EXPIRES));
      assert.ok(expires >= before + DAY - 1000 && expires <= Date.now() + DAY + 1000, `was ${expires}`);
      assert.equal(notes.length, 1);
      assert.match(notes[0], /Cannot check/);
      assert.equal(localStorage.getItem(LATEST), null);
      assert.equal(instance.$('button'), null);
    });
  }

  it('should wait a week after a successful check', () => {
    mount();
    const before = Date.now();
    FakeXHR.instances[0].respond(200, JSON.stringify({ tag_name: '2.0.0', html_url: 'https://example.com' }));
    assert.ok(Number(localStorage.getItem(EXPIRES)) >= before + 7 * DAY);
  });

  const releaseHref = (html_url) => {
    localStorage.setItem(LATEST, JSON.stringify({ tag_name: '2.0.0', html_url }));
    localStorage.setItem(EXPIRES, String(Date.now() + DAY));
    const instance = mount();
    instance.update({ open: true });
    return instance.$('a.btn--primary').getAttribute('href');
  };

  it('should link to an https release page', () => {
    assert.equal(
      releaseHref('https://github.com/yorch/docker-registry-ui/releases/tag/2.0.0'),
      'https://github.com/yorch/docker-registry-ui/releases/tag/2.0.0',
    );
  });

  it('should not render a non-https release url as a link target', () => {
    assert.equal(releaseHref('javascript:alert(1)'), null);
    assert.equal(releaseHref('http://example.com/'), null);
  });
});
