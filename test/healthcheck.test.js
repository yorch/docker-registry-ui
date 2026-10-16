/*
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
 * Runs bin/healthcheck.sh against a throwaway HTTP server: healthy only when `/`
 * answers 200 on the port NGINX_LISTEN_PORT names, whatever /v2 does.
 */
import assert from 'node:assert';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'healthcheck.sh');

describe('healthcheck.sh', () => {
  let server;
  let port;
  let rootStatus;

  beforeEach(async () => {
    rootStatus = 200;
    server = createServer((req, res) => {
      res.writeHead(req.url === '/' ? rootStatus : 502).end();
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

  it('should not depend on the proxied registry', async () => {
    // The stub answers 502 for everything but `/`, as nginx does with the registry down.
    assert.equal(await check(String(port)), 0);
  });

  it('should be a valid shell script', () => {
    assert.equal(spawnSync('sh', ['-n', script]).status, 0);
  });
});
