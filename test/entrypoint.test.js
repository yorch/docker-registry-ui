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
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      chmodSync(join(dir, 'nginx', 'conf.d'), 0o755);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'entrypoint-'));
  scratch.push(dir);
  const html = join(dir, 'html');
  const nginx = join(dir, 'nginx');
  mkdirSync(html);
  mkdirSync(join(nginx, 'conf.d'), { recursive: true });
  writeFileSync(join(html, 'index.html'), `<html><body>${productionMarkup}</body></html>`);
  writeFileSync(join(nginx, 'nginx.conf'), 'user  nginx;\npid /run/nginx.pid;\n');
  copyFileSync(join(root, 'nginx', 'default.conf'), join(nginx, 'conf.d', 'default.conf'));
  return {
    dir,
    html: join(html, 'index.html'),
    conf: join(nginx, 'conf.d', 'default.conf'),
    nginx,
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

const ph = (name) => `\${${name}}`;
const attr = (html, name) => new RegExp(`(?<![-\\w])${name}="([^"]*)"`).exec(html)?.[1];

describe('container entrypoint', function () {
  // Every case spawns the real script a few times (~0.3s each).
  this.timeout(30000);

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
        // Only the exact string `true` enables deletion, in the UI and in nginx alike.
        ['1', 'false'],
        ['yes', 'false'],
        ['True', 'false'],
        ['x" y', 'false'],
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

    it('denies only DELETE on /v2 unless DELETE_IMAGES is exactly true', () => {
      for (const [env, denied] of [
        [{}, true],
        [{ DELETE_IMAGES: 'false' }, true],
        [{ DELETE_IMAGES: '0' }, true],
        [{ DELETE_IMAGES: 'no' }, true],
        [{ DELETE_IMAGES: 'FALSE' }, true],
        [{ DELETE_IMAGES: 'True' }, true],
        [{ DELETE_IMAGES: 'true' }, false],
      ]) {
        const t = setup();
        assert.strictEqual(t.run({ ...proxied, ...env }).status, 0);
        const conf = readFileSync(t.conf, 'utf8');
        assert.strictEqual(
          /^\s*if \(\$request_method = DELETE\) \{ return 403; \}/m.test(conf),
          denied,
          JSON.stringify(env),
        );
        // docker push (POST/PUT/PATCH) through the proxy is never blocked.
        assert.doesNotMatch(conf, /limit_except/);
      }
    });

    it('rejects a placeholder in a value, which would pull in another variable', () => {
      const t = setup();
      const r = t.run({
        ...proxied,
        NGINX_PROXY_HEADER_X_Bad: `a ${ph('NGINX_RESOLVER')} b`,
        NGINX_RESOLVER: '127.0.0.11',
      });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /NGINX_PROXY_HEADER_X_Bad/);
    });

    it('accepts hyphens in header names from the environment and from .env alike', () => {
      const t = setup();
      writeFileSync(join(t.nginx, '.env'), 'NGINX_PROXY_HEADER_X-From-File=two\n');
      const r = t.run({ ...proxied, 'NGINX_PROXY_HEADER_X-Forwarded-Proto': 'https' });
      assert.strictEqual(r.status, 0, r.stderr);
      const conf = readFileSync(t.conf, 'utf8');
      assert.match(conf, /proxy_set_header X-Forwarded-Proto "https";/);
      assert.match(conf, /proxy_set_header X-From-File "two";/);
    });

    it('fails the same way for an invalid name from the environment as from .env', () => {
      const t = setup();
      const r = t.run({ ...proxied, 'NGINX_PROXY_HEADER_X.Bad': 'v' });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /invalid variable name/);
    });
  });

  describe('NGINX_LISTEN_PORT', () => {
    it('writes a plain port and a host:port', () => {
      for (const port of ['8081', '127.0.0.1:8081']) {
        const t = setup();
        assert.strictEqual(t.run({ NGINX_LISTEN_PORT: port }).status, 0);
        assert.match(readFileSync(t.conf, 'utf8'), new RegExp(`listen       ${port};`));
      }
    });

    it('refuses a value that is not a port, and leaves the live file untouched', () => {
      for (const port of ['80,81', '81;x', '8 1', '81|x']) {
        const t = setup();
        const before = readFileSync(t.conf, 'utf8');
        const r = t.run({ NGINX_LISTEN_PORT: port });
        assert.notStrictEqual(r.status, 0, port);
        assert.match(r.stderr, /NGINX_LISTEN_PORT/);
        assert.strictEqual(readFileSync(t.conf, 'utf8'), before);
      }
    });
  });

  describe('values are data', () => {
    it('does not expand another placeholder inside an index.html value', () => {
      const t = setup();
      const r = t.run({ APP_NAME: ph('REGISTRY_URL'), REGISTRY_URL: 'http://secret' });
      assert.strictEqual(r.status, 0, r.stderr);
      const html = readFileSync(t.html, 'utf8');
      assert.strictEqual(attr(html, 'app-name'), '&#36;{REGISTRY_URL}');
      assert.strictEqual(attr(html, 'registry-url'), 'http://secret');
    });
  });

  describe('files the entrypoint does not own', () => {
    const custom = 'server {\n    listen 80;\n    add_header X-Frame-Options "SAMEORIGIN";\n}\n';
    const stat = (f) => readFileSync(f, 'utf8');

    it('leaves a custom conf without markers alone, whatever the environment says', () => {
      const t = setup();
      writeFileSync(t.conf, custom);
      const r = t.run({ CONTENT_SECURITY_POLICY: "default-src 'self'", NGINX_PROXY_PASS_URL: 'http://r:5000' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(stat(t.conf), custom);
    });

    it("keeps a custom conf with markers but never deletes the user's own X-Frame-Options", () => {
      const t = setup();
      const conf = `${custom}# \${CONTENT_SECURITY_POLICY}\n`;
      writeFileSync(t.conf, conf);
      assert.strictEqual(t.run({ CONTENT_SECURITY_POLICY: "default-src 'self'" }).status, 0);
      assert.match(stat(t.conf), /X-Frame-Options "SAMEORIGIN"/);
    });

    it('does not fail on a read-only conf: it warns and goes on', function () {
      if (process.getuid?.() === 0) this.skip();
      const t = setup();
      const before = stat(t.conf);
      chmodSync(t.conf, 0o444);
      chmodSync(dirname(t.conf), 0o555);
      const r = t.run({ APP_NAME: 'x' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stderr, /default\.conf/);
      assert.strictEqual(stat(t.conf), before);
      assert.strictEqual(attr(stat(t.html), 'app-name'), 'x');
    });

    it('does not even warn about a read-only custom conf that needs no rendering', function () {
      if (process.getuid?.() === 0) this.skip();
      const t = setup();
      writeFileSync(t.conf, custom);
      chmodSync(t.conf, 0o444);
      chmodSync(dirname(t.conf), 0o555);
      const r = t.run({});
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stderr, '');
    });

    it('does not fail on a read-only index.html', function () {
      if (process.getuid?.() === 0) this.skip();
      const t = setup();
      chmodSync(t.html, 0o444);
      chmodSync(dirname(t.html), 0o555);
      try {
        const r = t.run({ APP_NAME: 'x' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stderr, /index\.html/);
      } finally {
        chmodSync(dirname(t.html), 0o755);
      }
    });

    it('treats a host edit between restarts as the new pristine copy', () => {
      const t = setup();
      assert.strictEqual(t.run({ APP_NAME: 'one' }).status, 0);
      const edited = `${stat(t.conf)}\n# edited on the host, with a \${CONTENT_SECURITY_POLICY} marker\n`;
      writeFileSync(t.conf, edited);
      assert.strictEqual(t.run({ APP_NAME: 'two' }).status, 0);
      assert.match(stat(t.conf), /edited on the host/);
      // and it is rendered from there on, not overwritten with the stale copy
      assert.doesNotMatch(stat(t.conf), /with a \$\{CONTENT/);
      assert.strictEqual(t.run({}).status, 0);
      assert.match(stat(t.conf), /edited on the host/);
    });

    it('keeps a host edit that has no markers', () => {
      const t = setup();
      assert.strictEqual(t.run({}).status, 0);
      writeFileSync(t.conf, custom);
      assert.strictEqual(t.run({}).status, 0);
      assert.strictEqual(stat(t.conf), custom);
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
