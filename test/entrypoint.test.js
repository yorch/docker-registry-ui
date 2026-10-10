/*
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
 * Runs the container entrypoint hook (bin/90-docker-registry-ui.sh) for real, in
 * a throwaway directory, against hostile environment values. The script renders
 * environment variables into index.html and into the nginx config with sed, and
 * a value containing the sed delimiter, `&` or a quote used to corrupt the
 * output or escape the HTML attribute / nginx string it was written into.
 *
 * The script reads and writes paths from UI_INDEX_HTML and UI_NGINX_DIR so it can
 * run outside a container; in the image both default to the real locations.
 */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'bin', '90-docker-registry-ui.sh');

// The production markup is the block src/index.html marks `build:keep production`
// (dist/index.html is that block with the markers stripped), so this needs no build.
const source = readFileSync(join(root, 'src', 'index.html'), 'utf8');
const productionMarkup = source.split('<!-- build:keep production -->')[1].split('<!-- endbuild -->')[0];

// A scratch tree shaped like the container: <dir>/html/index.html and
// <dir>/nginx/{nginx.conf,conf.d/default.conf}.
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'entrypoint-'));
  const html = join(dir, 'html');
  const nginx = join(dir, 'nginx');
  mkdirSync(html);
  mkdirSync(join(nginx, 'conf.d'), { recursive: true });
  writeFileSync(join(html, 'index.html'), `<html><body>${productionMarkup}</body></html>`);
  writeFileSync(join(nginx, 'nginx.conf'), 'user  nginx;\npid /run/nginx.pid;\n');
  copyFileSync(join(root, 'nginx', 'default.conf'), join(nginx, 'conf.d', 'default.conf'));
  return {
    html: join(html, 'index.html'),
    conf: join(nginx, 'conf.d', 'default.conf'),
    run: (env = {}) =>
      spawnSync('sh', [script], {
        cwd: html,
        encoding: 'utf8',
        // Not the parent environment: a developer's own APP_NAME or
        // NGINX_PROXY_HEADER_* would change what is being asserted.
        env: { PATH: process.env.PATH, UI_INDEX_HTML: join(html, 'index.html'), UI_NGINX_DIR: nginx, ...env },
      }),
  };
};

const attr = (html, name) => new RegExp(`(?<![-\\w])${name}="([^"]*)"`).exec(html)?.[1];

describe('container entrypoint', () => {
  describe('index.html', () => {
    it('substitutes plain values and leaves no placeholder behind', () => {
      const t = setup();
      const r = t.run({ REGISTRY_URL: 'http://registry:5000', THEME: 'dark', THEME_PRIMARY_TEXT: '#fff' });
      assert.strictEqual(r.status, 0, r.stderr);
      const html = readFileSync(t.html, 'utf8');
      assert.strictEqual(attr(html, 'registry-url'), 'http://registry:5000');
      assert.strictEqual(attr(html, 'theme'), 'dark');
      assert.strictEqual(attr(html, 'theme-primary-text'), '#fff');
      assert.strictEqual(attr(html, 'app-name'), '');
      assert.doesNotMatch(html, /\$\{/);
    });

    it('keeps values containing sed metacharacters intact', () => {
      const t = setup();
      // & ~ , ^ | \ and / are each the delimiter or a special in a sed replacement.
      const value = 'a&b~c,d^e|f\\g/h \\1 &';
      const r = t.run({ REGISTRY_TITLE: value });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(attr(readFileSync(t.html, 'utf8'), 'name'), 'a&amp;b~c,d^e|f\\g/h \\1 &amp;');
    });

    it('HTML-escapes values so they cannot leave the attribute', () => {
      const t = setup();
      const r = t.run({ APP_NAME: `x" onfocus="alert(1)" '<script>` });
      assert.strictEqual(r.status, 0, r.stderr);
      const html = readFileSync(t.html, 'utf8');
      assert.strictEqual(attr(html, 'app-name'), 'x&quot; onfocus=&quot;alert(1)&quot; &#39;&lt;script&gt;');
      assert.doesNotMatch(html, /onfocus="/);
    });

    it('renders DELETE_IMAGES as a strict boolean', () => {
      for (const [input, expected] of [
        [undefined, 'false'],
        ['false', 'false'],
        ['true', 'true'],
        ['x" y', 'true'],
      ]) {
        const t = setup();
        const r = t.run(input === undefined ? {} : { DELETE_IMAGES: input });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(attr(readFileSync(t.html, 'utf8'), 'is-image-remove-activated'), expected);
      }
    });

    it('renders from a pristine copy, so a restart with new env takes effect', () => {
      const t = setup();
      assert.strictEqual(t.run({ APP_NAME: 'first' }).status, 0);
      assert.strictEqual(attr(readFileSync(t.html, 'utf8'), 'app-name'), 'first');
      assert.strictEqual(t.run({ APP_NAME: 'second', NGINX_PROXY_PASS_URL: 'http://r:5000' }).status, 0);
      assert.strictEqual(attr(readFileSync(t.html, 'utf8'), 'app-name'), 'second');
      assert.match(readFileSync(t.conf, 'utf8'), /proxy_pass http:\/\/r:5000;/);
      // And turning the proxy back off un-renders the /v2 block.
      assert.strictEqual(t.run({}).status, 0);
      assert.doesNotMatch(readFileSync(t.conf, 'utf8'), /^\s*proxy_pass/m);
    });
  });

  describe('nginx proxy', () => {
    const proxied = { NGINX_PROXY_PASS_URL: 'http://registry:5000' };

    it('writes proxy_set_header values containing sed metacharacters verbatim', () => {
      const t = setup();
      const r = t.run({ ...proxied, NGINX_PROXY_HEADER_X_Weird: 'a&b~c,d^e|f/g $http_host' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(readFileSync(t.conf, 'utf8'), /proxy_set_header X-Weird "a&b~c,d\^e\|f\/g \$http_host";/);
    });

    for (const [label, value] of [
      ['a double quote', 'a"b'],
      ['a semicolon', 'a;b'],
      ['a newline', 'a\nb'],
      ['a backslash', 'a\\'],
    ]) {
      it(`refuses to start when a header value contains ${label}`, () => {
        const t = setup();
        const r = t.run({ ...proxied, NGINX_PROXY_HEADER_X_Bad: value });
        assert.notStrictEqual(r.status, 0);
        assert.match(r.stderr, /NGINX_PROXY_HEADER_X_Bad/);
      });
    }

    it('applies the same check to NGINX_PROXY_PASS_URL', () => {
      const t = setup();
      const r = t.run({ NGINX_PROXY_PASS_URL: 'http://r:5000; return 200' });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /NGINX_PROXY_PASS_URL/);
    });

    it('denies write methods on /v2 unless DELETE_IMAGES is enabled', () => {
      for (const [env, denied] of [
        [{}, true],
        [{ DELETE_IMAGES: 'false' }, true],
        [{ DELETE_IMAGES: 'true' }, false],
      ]) {
        const t = setup();
        assert.strictEqual(t.run({ ...proxied, ...env }).status, 0);
        const conf = readFileSync(t.conf, 'utf8');
        assert.strictEqual(
          /^\s*limit_except GET HEAD OPTIONS \{ deny all; \}/m.test(conf),
          denied,
          JSON.stringify(env),
        );
      }
    });
  });

  describe('security headers', () => {
    it('sends a CSP, framing, nosniff and referrer headers by default', () => {
      const t = setup();
      assert.strictEqual(t.run().status, 0);
      const conf = readFileSync(t.conf, 'utf8');
      assert.match(conf, /add_header Content-Security-Policy "[^"]*frame-ancestors 'none'[^"]*" always;/);
      assert.match(conf, /add_header X-Frame-Options "DENY" always;/);
      assert.match(conf, /add_header X-Content-Type-Options "nosniff" always;/);
      assert.match(conf, /add_header Referrer-Policy "same-origin" always;/);
      assert.doesNotMatch(conf, /Policy "[^"]*\$\{/);
    });

    it('CONTENT_SECURITY_POLICY replaces the policy and hands framing to it', () => {
      const t = setup();
      const csp = "default-src 'self'; frame-ancestors https://wiki";
      assert.strictEqual(t.run({ CONTENT_SECURITY_POLICY: csp }).status, 0);
      const conf = readFileSync(t.conf, 'utf8');
      assert.match(
        conf,
        /add_header Content-Security-Policy "default-src 'self'; frame-ancestors https:\/\/wiki" always;/,
      );
      assert.doesNotMatch(conf, /X-Frame-Options/);
      assert.match(conf, /X-Content-Type-Options/);
    });

    it('CONTENT_SECURITY_POLICY=off drops the CSP and X-Frame-Options only', () => {
      const t = setup();
      assert.strictEqual(t.run({ CONTENT_SECURITY_POLICY: 'off' }).status, 0);
      const conf = readFileSync(t.conf, 'utf8');
      assert.doesNotMatch(conf, /Content-Security-Policy|X-Frame-Options/);
      assert.match(conf, /X-Content-Type-Options/);
    });

    it('rejects a CSP value that could break out of the nginx string', () => {
      const t = setup();
      const r = t.run({ CONTENT_SECURITY_POLICY: 'a" ; b' });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /CONTENT_SECURITY_POLICY/);
    });
  });
});
