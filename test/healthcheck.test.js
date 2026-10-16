/*
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
 * Runs bin/healthcheck.sh against a throwaway HTTP server: healthy only when `/`
 * answers 200 on the port NGINX_LISTEN_PORT names, whatever /v2 does (the script never requests it).
 */
import assert from 'node:assert';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'healthcheck.sh');

describe('healthcheck.sh', () => {
  let server;
  let port;
  let rootStatus;

  beforeEach(async () => {
    rootStatus = 200;
    server = createServer((_req, res) => {
      res.writeHead(rootStatus).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  // Async so the in-process server can answer while the script runs.
  const check = (listen) =>
    new Promise((resolve) => {
      const env = { PATH: process.env.PATH };
      if (listen !== undefined) {
        env.NGINX_LISTEN_PORT = listen;
      }
      execFile('sh', [script], { env }, (error) => resolve(error ? error.code : 0));
    });

  it('should be healthy when / answers 200 on NGINX_LISTEN_PORT', async () => {
    assert.equal(await check(String(port)), 0);
  });

  it('should accept an address:port', async () => {
    assert.equal(await check(`127.0.0.1:${port}`), 0);
  });

  it('should be unhealthy when / does not answer 200', async () => {
    rootStatus = 404;
    assert.notEqual(await check(String(port)), 0);
  });

  it('should be unhealthy when nothing listens on the port', async () => {
    const closed = port;
    await new Promise((resolve) => server.close(resolve));
    assert.notEqual(await check(String(closed)), 0);
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  // Which URL is probed when nothing can be bound on 80 or 8080 here: a fake curl
  // records the URL, a fake id reports the uid. The rule is the entrypoint's: only
  // exactly "80" moves a non-root user to 8080; an empty value leaves nginx on 80.
  describe('the probed port', () => {
    let shim;
    beforeEach(() => {
      shim = mkdtempSync(join(tmpdir(), 'healthcheck-'));
    });
    afterEach(() => rmSync(shim, { recursive: true, force: true }));

    const probed = (uid, listen) => {
      writeFileSync(join(shim, 'curl'), `#!/bin/sh\nfor a; do url=$a; done\necho "$url" > "${shim}/url"\n`, {
        mode: 0o755,
      });
      writeFileSync(join(shim, 'id'), `#!/bin/sh\necho ${uid}\n`, { mode: 0o755 });
      const env = { PATH: `${shim}:/usr/bin:/bin` };
      if (listen !== undefined) {
        env.NGINX_LISTEN_PORT = listen;
      }
      assert.equal(spawnSync('/bin/sh', [script], { env }).status, 0);
      return readFileSync(join(shim, 'url'), 'utf8').trim();
    };

    it('should use 80 as root when the variable is unset, empty or 80', () => {
      assert.equal(probed(0), 'http://127.0.0.1:80/');
      assert.equal(probed(0, ''), 'http://127.0.0.1:80/');
      assert.equal(probed(0, '80'), 'http://127.0.0.1:80/');
    });

    it('should use 8080 for a non-root user on 80, as the entrypoint moves it', () => {
      assert.equal(probed(101), 'http://127.0.0.1:8080/');
      assert.equal(probed(101, '80'), 'http://127.0.0.1:8080/');
    });

    it('should keep 80 for a non-root user with an empty value, as nginx does', () => {
      assert.equal(probed(101, ''), 'http://127.0.0.1:80/');
    });

    it('should leave any other port alone', () => {
      assert.equal(probed(101, '9090'), 'http://127.0.0.1:9090/');
    });
  });

  it('should be a valid shell script', () => {
    assert.equal(spawnSync('sh', ['-n', script]).status, 0);
  });
});
