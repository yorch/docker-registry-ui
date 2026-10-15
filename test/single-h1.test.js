/*
 * One h1 per screen. The app shell carries the product title as a visually
 * hidden h1; the error page's big status code used to be a second one.
 */
import assert from 'node:assert';
import { component } from 'riot';
import App from '../src/components/docker-registry-ui.riot';
import ErrorPage from '../src/components/error-page.riot';

class SilentXHR {
  addEventListener() {}
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {}
}

describe('one h1 per screen', () => {
  const realXHR = globalThis.XMLHttpRequest;
  let app;

  beforeEach(() => {
    globalThis.XMLHttpRequest = SilentXHR;
    document.body.replaceChildren();
  });
  afterEach(() => {
    app?.unmount();
    app = undefined;
    globalThis.XMLHttpRequest = realXHR;
    document.body.replaceChildren();
  });

  const mountApp = () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    app = component(App)(root, { registryUrl: 'https://registry.example.com', singleRegistry: 'true', theme: 'light' });
    return root;
  };

  it('should render exactly one h1 in the app shell', () => {
    const root = mountApp();
    assert.equal(root.querySelectorAll('h1').length, 1);
  });

  for (const code of ['CATALOG_NOT_FOUND', 'PAGINATION_NUMBER_INVALID']) {
    it(`should still render exactly one h1 with the ${code} error page showing its status code`, () => {
      const root = mountApp();
      app.update({ pageError: { code, url: 'https://registry.example.com/v2/_catalog' } });
      assert.ok(root.querySelector('error-page'), 'the error page should be mounted');
      assert.match(root.querySelector('error-page .status-code')?.textContent ?? '', /^(404|400)$/);
      assert.equal(root.querySelectorAll('h1').length, 1);
    });
  }

  it('should not render an h1 of its own in the error page', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    component(ErrorPage)(root, { code: 'CATALOG_NOT_FOUND', url: 'https://registry.example.com' });
    assert.equal(root.querySelectorAll('h1').length, 0);
  });
});
