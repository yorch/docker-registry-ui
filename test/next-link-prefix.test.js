import assert from 'node:assert';
import { parseNextLink } from '../src/scripts/registry-client.js';

// A registry behind `proxy_pass https://backend/` at /registry does not know it
// is mounted there, so its Link header is root-relative to the backend (M-COR-9).
describe('parseNextLink behind a path prefix', () => {
  const registry = 'https://host.example/registry';
  const page = `${registry}/v2/app/tags/list`;

  it('should re-root a prefix-unaware root-relative link under the registry prefix', () => {
    assert.equal(
      parseNextLink('</v2/app/tags/list?last=a>; rel="next"', page, registry),
      'https://host.example/registry/v2/app/tags/list?last=a',
    );
  });

  it('should leave a link that already carries the prefix alone', () => {
    assert.equal(
      parseNextLink('</registry/v2/app/tags/list?last=a>; rel="next"', page, registry),
      'https://host.example/registry/v2/app/tags/list?last=a',
    );
  });

  it('should still refuse another origin, a protocol-relative link and a non-API path', () => {
    assert.equal(parseNextLink('<https://evil.example/v2/app/tags/list>; rel="next"', page, registry), undefined);
    assert.equal(parseNextLink('<//evil.example/v2/x>; rel="next"', page, registry), undefined);
    assert.equal(parseNextLink('</admin/secret>; rel="next"', page, registry), undefined);
  });

  it('should not re-root an absolute same-origin link that is outside the prefix', () => {
    assert.equal(parseNextLink('<https://host.example/v2/app/tags/list>; rel="next"', page, registry), undefined);
  });

  it('should be unchanged for a registry with no prefix', () => {
    assert.equal(
      parseNextLink(
        '</v2/app/tags/list?last=a>; rel="next"',
        'https://host.example/v2/app/tags/list',
        'https://host.example',
      ),
      'https://host.example/v2/app/tags/list?last=a',
    );
  });
});
