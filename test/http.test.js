import { Http } from '../src/scripts/http.js';
import { setCache } from '../src/scripts/cache-request.js';
import assert from 'assert';

const REGISTRY = 'https://registry.example.com';
const TAGS_URL = `${REGISTRY}/v2/nginx/tags/list`;
const DIGEST = 'sha256:' + 'b2'.repeat(32);

const seed = (url, text) => setCache('GET', url, { responseText: text, dockerContentdigest: DIGEST });

// Records which events fired, in order, along with what the handler saw as
// `this` -- consumers rely on being bound to the response.
const recordingRequest = (opts) => {
  const req = new Http(opts);
  const seen = [];
  ['load', 'loadend'].forEach((name) => {
    req.addEventListener(name, function () {
      seen.push({ name, status: this.status, responseText: this.responseText });
    });
  });
  return { req, seen };
};

describe('Http cache replay', () => {
  beforeEach(() => sessionStorage.clear());

  // tag-list parses the response in `load` while catalog's tag-count fetch
  // parses the same URL in `loadend`. A replay that fires only `loadend` leaves
  // the tag list rendering nothing at all, with no error anywhere.
  it('should fire load before loadend on a cache hit', () => {
    seed(TAGS_URL, '{"tags":["latest"]}');
    const { req, seen } = recordingRequest({});
    req.open('GET', TAGS_URL);
    req.send();
    assert.deepEqual(
      seen.map((e) => e.name),
      ['load', 'loadend'],
    );
  });

  it('should bind both handlers to a successful response', () => {
    seed(TAGS_URL, '{"tags":["latest"]}');
    const { req, seen } = recordingRequest({});
    req.open('GET', TAGS_URL);
    req.send();
    assert.equal(seen.length, 2, 'both handlers should have run');
    seen.forEach((event) => {
      assert.equal(event.status, 200, `${event.name} should see status 200`);
      assert.equal(event.responseText, '{"tags":["latest"]}', `${event.name} should see the cached body`);
    });
  });

  it('should still replay when only loadend is registered', () => {
    seed(TAGS_URL, '{"tags":["latest"]}');
    const req = new Http({});
    const seen = [];
    req.addEventListener('loadend', function () {
      seen.push(this.responseText);
    });
    req.open('GET', TAGS_URL);
    req.send();
    assert.deepEqual(seen, ['{"tags":["latest"]}']);
  });

  it('should expose the cached content digest', () => {
    seed(TAGS_URL, '{"tags":["latest"]}');
    const req = new Http({});
    req.addEventListener('loadend', function () {});
    req.open('GET', TAGS_URL);
    req.send();
    let digest;
    req.getContentDigest((value) => {
      digest = value;
    });
    assert.equal(digest, DIGEST);
  });

  it('should not replay for a url that is not cached', () => {
    const { req, seen } = recordingRequest({});
    req.open('GET', `${REGISTRY}/v2/_catalog?n=10`);
    req.send();
    assert.deepEqual(seen, []);
  });

  // The delete flow reads Docker-Content-Digest from a tag-addressed manifest
  // and then deletes by that digest. A stale digest deletes the wrong manifest,
  // so that request has to reach the registry.
  it('should bypass the cache when noCache is set', () => {
    seed(TAGS_URL, '{"tags":["latest"]}');
    const { req, seen } = recordingRequest({ noCache: true });
    req.open('GET', TAGS_URL);
    req.send();
    assert.deepEqual(seen, [], 'no replay should happen when the cache is bypassed');
  });
});
