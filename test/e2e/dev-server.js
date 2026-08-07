/*
 * Starts the real dev server for the end-to-end run.
 *
 * `npm start` is used rather than a purpose-built harness so the tests exercise
 * the path a developer actually uses: rollup builds the bundle, substitutes the
 * dev configuration into index.html, and boots the mock registry. A separate
 * harness could drift from that quietly.
 */

import { spawn } from 'node:child_process';

const APP_URL = 'http://localhost:8000/';
const READY_TIMEOUT_MS = 120000;

const reachable = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

export const startDevServer = async (env = {}) => {
  // Refuse to run against a server this function did not start. Readiness is a
  // reachability check, so a dev server left running from an earlier session
  // would satisfy it while the build under test never started -- the suite
  // would pass against whatever that server happens to be serving.
  if (await reachable(APP_URL)) {
    throw new Error(
      `something is already listening on ${APP_URL}. Stop it first: these tests must drive the build under test, not a server that was already running.`,
    );
  }

  const child = spawn('npm', ['start'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Makes the child a process-group leader so the whole group can be signalled
    // on the way out; killing npm alone leaves rollup holding the ports.
    detached: true,
  });

  // Kept so a startup failure can be reported instead of surfacing as an
  // unexplained readiness timeout.
  let output = '';
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });

  let exited = null;
  child.on('exit', (code) => {
    exited = code;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`dev server exited with code ${exited} before becoming ready:\n${output}`);
    }
    if (await reachable(APP_URL)) {
      return {
        url: APP_URL,
        stop: () =>
          new Promise((resolve) => {
            if (exited !== null) {
              return resolve();
            }
            child.once('exit', () => resolve());
            // Kill the process group: `npm start` spawns rollup as a child, and
            // killing only npm would leave rollup holding ports 8000 and 5555.
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {
              child.kill('SIGTERM');
            }
          }),
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server was not reachable within ${READY_TIMEOUT_MS}ms:\n${output}`);
};
