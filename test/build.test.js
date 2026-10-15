/*
 * Builds the production bundle into a scratch directory and checks the things
 * the container and the rest of the repository rely on, none of which need a
 * browser: the exact file layout, the `${...}` placeholders surviving in
 * index.html for the entrypoint script, a classic-script IIFE bundle, and the
 * version.json fields.
 */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import copyTransform from '../build/copy-transform.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_FILES = [
  'docker-registry-ui.css',
  'docker-registry-ui.js',
  'fonts/IBMPlexMono-Bold.ttf',
  'fonts/IBMPlexMono-Medium.ttf',
  'fonts/IBMPlexMono-Regular.ttf',
  'fonts/IBMPlexMono-SemiBold.ttf',
  'fonts/IBMPlexSans.ttf',
  'fonts/material-symbols-rounded.ttf',
  'fonts/material-symbols-rounded.woff',
  'fonts/material-symbols-rounded.woff2',
  'images/docker-logo.svg',
  'images/rocket.svg',
  'index.html',
  'version.json',
];

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();

describe('production build', () => {
  let out;
  const read = (file) => readFileSync(join(out, file), 'utf8');

  before(function () {
    this.timeout(60000);
    mkdirSync(join(root, 'tmp'), { recursive: true });
    out = mkdtempSync(join(root, 'tmp', 'build-test-'));
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, COMMIT_HASH: 'abc1234', DEVELOPMENT_BUILD: 'abcdefghijklmnop' },
      },
    );
    assert.equal(result.status, 0, `vite build failed:\n${result.stdout}\n${result.stderr}`);
  });

  after(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it('should emit exactly the expected unhashed files', () => {
    assert.deepEqual(listFiles(out), EXPECTED_FILES);
  });

  it('should leave the index.html placeholders for the container entrypoint', () => {
    const html = read('index.html');
    const source = readFileSync(join(root, 'src', 'index.html'), 'utf8');
    const production = source.split('<!-- build:keep production -->')[1].split('<!-- endbuild -->')[0];
    const placeholders = (text) => [...new Set(text.match(/\$\{[A-Z_]+\}/g))].sort();

    assert.ok(placeholders(production).length > 20, 'the source markup should carry the placeholders');
    assert.deepEqual(placeholders(html), placeholders(production));
    assert.match(html, /<script src="docker-registry-ui\.js"><\/script>/);
    assert.match(html, /<link href="docker-registry-ui\.css" rel="stylesheet" type="text\/css">/);
    assert.doesNotMatch(html, /type="module"|modulepreload/);
  });

  it('should bundle the app as a classic-script IIFE', () => {
    const code = read('docker-registry-ui.js');
    assert.match(code, /^\/\*\s*\n \* Copyright/, 'the licence header should come first');
    assert.doesNotMatch(code, /^\s*(import|export)\s/m);
    assert.doesNotMatch(code, /import\.meta/);
    // Parses as a script, not a module, and without running it.
    assert.doesNotThrow(() => new vm.Script(code));
    assert.match(code, /\*\/\s*\(function\(\)\{/, 'the bundle should be a bare IIFE after the header');
    assert.match(code.trimEnd(), /\}\)\(\);$/);
  });

  it('should not ship syntax beyond the README browser floor (ES2020)', () => {
    // The target keeps the minifier from emitting ES2021 logical assignment.
    assert.doesNotMatch(read('docker-registry-ui.js'), /(?:&&|\|\||\?\?)=/);
  });

  it('should put the design tokens ahead of the component styles', () => {
    const css = read('docker-registry-ui.css');
    assert.ok(css.indexOf(':root') !== -1 && css.indexOf(':root') < css.indexOf('.btn'));
  });

  it('should copy the images through copy-transform', () => {
    for (const name of ['docker-logo.svg', 'rocket.svg']) {
      const expected = copyTransform(readFileSync(join(root, 'src', 'images', name)), name);
      assert.equal(read(`images/${name}`), expected.toString());
    }
  });

  it('should write version.json with the dev suffix and the commit', () => {
    const { version, latest, commit } = JSON.parse(read('version.json'));
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const [major, minor] = pkg.split('.').map(Number);
    assert.equal(latest, pkg);
    assert.equal(version, `${major}.${minor + 1}.0-abcdefghij`);
    assert.equal(commit, 'abc1234');
  });
});
