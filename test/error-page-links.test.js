import assert from 'node:assert';
import { component } from 'riot';
import ErrorPage from '../src/components/error-page.riot';

const mount = (props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(ErrorPage)(root, props);
};

const link = (page, text) => [...page.root.querySelectorAll('a')].find((a) => a.textContent.trim() === text);

describe('error page links', () => {
  afterEach(() => document.body.replaceChildren());

  it('should link the contact point when it is an http(s) url', () => {
    const url = 'https://registry.example.com/v2/_catalog';
    const page = mount({ code: 'CATALOG_NOT_FOUND', url });
    assert.equal(link(page, url).getAttribute('href'), url);
  });

  it('should show but not link a contact point with another scheme', () => {
    const url = 'javascript:alert(document.domain)';
    const page = mount({ code: 'CATALOG_NOT_FOUND', url });
    assert.equal(link(page, url).getAttribute('href'), null);
  });

  it('should not throw or link a javascript: url in the mixed content message', () => {
    const page = mount({ code: 'MIXED_CONTENT', url: 'javascript:alert(1)' });
    const hrefs = [...page.root.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter(Boolean);
    assert.ok(!hrefs.some((href) => href.startsWith('javascript:')), `unexpected hrefs ${hrefs}`);
  });

  it('should still link the origin in the mixed content message', () => {
    const page = mount({ code: 'MIXED_CONTENT', url: 'http://registry.example.com:5000/v2/_catalog' });
    assert.ok(link(page, 'http://registry.example.com:5000'));
  });
});
