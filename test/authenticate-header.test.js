import assert from 'node:assert';
import { parseAuthenticateHeader } from '../src/scripts/http.js';

describe('parseAuthenticateHeader', () => {
  const expected = { realm: 'https://auth.example/token', service: 'registry', scope: 'repository:a:pull' };

  it('should read the usual realm, service, scope order', () => {
    const parsed = parseAuthenticateHeader(
      'Bearer realm="https://auth.example/token",service="registry",scope="repository:a:pull"',
    );
    assert.deepEqual({ ...parsed }, expected);
  });

  it('should not depend on parameter order or spacing', () => {
    const parsed = parseAuthenticateHeader(
      'Bearer scope="repository:a:pull", service="registry", realm="https://auth.example/token"',
    );
    assert.deepEqual({ ...parsed }, expected);
  });

  it('should ignore extra parameters such as error', () => {
    const parsed = parseAuthenticateHeader(
      'Bearer realm="https://auth.example/token",service="registry",scope="repository:a:pull",error="invalid_token"',
    );
    assert.deepEqual({ ...parsed }, expected);
  });

  it('should return nothing for a non-bearer challenge', () => {
    assert.equal(parseAuthenticateHeader('Basic realm="Registry"'), undefined);
  });
});
