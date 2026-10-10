import assert from 'node:assert';
import { Http } from '../src/scripts/http.js';

describe('Http.getContentDigest without crypto.subtle', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', original);
  });

  it('calls back with undefined on an insecure context', () => {
    Object.defineProperty(globalThis, 'crypto', { value: { subtle: undefined }, configurable: true });
    const http = new Http({});
    http.oReq = { hasHeader: () => false, responseText: '{"a":1}' };
    const seen = [];
    http.getContentDigest((d) => seen.push(d));
    assert.deepEqual(seen, [undefined]);
  });

  it('calls back with undefined when digest rejects', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { digest: () => Promise.reject(new Error('no')) } },
      configurable: true,
    });
    const http = new Http({});
    http.oReq = { hasHeader: () => false, responseText: '{"a":1}' };
    const seen = [];
    http.getContentDigest((d) => seen.push(d));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(seen, [undefined]);
  });
});
