import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { getFromCache, setCache } from '../src/scripts/cache-request.js';
import { Http } from '../src/scripts/http.js';

const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('digest-addressed cache integrity (M-SEC-5)', () => {
  let server;
  let base;
  let body;

  beforeEach(async () => {
    sessionStorage.clear();
    body = '{"architecture":"amd64"}';
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const fetchOnce = (url, headers = {}) =>
    new Promise((resolve) => {
      const req = new Http({});
      req.addEventListener('loadend', () => resolve());
      req.open('GET', url);
      Object.entries(headers).forEach(([name, value]) => req.setRequestHeader(name, value));
      req.send();
    });

  it('should cache a blob whose body hashes to its digest', async () => {
    const url = `${base}/v2/app/blobs/${sha(body)}`;
    await fetchOnce(url);
    await sleep(50);
    assert.equal(getFromCache('GET', url)?.responseText, body);
  });

  it('should refuse to cache a body that does not hash to the digest in the URL', async () => {
    const url = `${base}/v2/app/blobs/${sha('something else')}`;
    await fetchOnce(url);
    await sleep(50);
    assert.equal(getFromCache('GET', url), undefined);
  });

  it('should keep caching tag-addressed responses, which have no digest to check', async () => {
    const url = `${base}/v2/app/tags/list`;
    await fetchOnce(url);
    assert.equal(getFromCache('GET', url)?.responseText, body);
  });
});

describe('USE_CONTROL_CACHE_HEADER (M-COR-6)', () => {
  beforeEach(() => sessionStorage.clear());

  it('should not replay a cached tag-addressed manifest when the request asks for no-cache', () => {
    const url = 'https://registry.example.com/v2/nginx/manifests/latest';
    setCache('GET', url, { responseText: '{"stale":true}', dockerContentdigest: sha('x') });
    const seen = [];
    const req = new Http({});
    req.addEventListener('loadend', function () {
      seen.push(this.status);
    });
    req.open('GET', url);
    req.setRequestHeader('Cache-Control', 'no-store, no-cache');
    req.send();
    assert.deepEqual(seen, [], 'the control header means the registry is asked, not sessionStorage');
  });
});
