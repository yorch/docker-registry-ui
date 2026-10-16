import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'mocha';

// What the footer shows for an image that is not a tagged release. The release
// workflow never sets VERSION_SUFFIX, so a release keeps the bare package version;
// the main-branch image sets it so "3.4.0" is not shown for code that is newer.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const scratch = join(root, 'tmp', `version-label-${process.pid}`);

const build = (env) => {
  mkdirSync(scratch, { recursive: true });
  const versionFile = join(scratch, `version-${Math.random().toString(36).slice(2)}.json`);
  const outDir = join(scratch, 'out');
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DEVELOPMENT_BUILD: '', VERSION_SUFFIX: '', ...env, VERSION_FILE: versionFile },
    },
  );
  assert.equal(result.status, 0, `vite build failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8'));
};

describe('version label for non-release builds', function () {
  // Each case runs a real `vite build`, which is slower on a CI runner.
  this.timeout(60000);

  after(() => rmSync(scratch, { recursive: true, force: true }));

  it('should show the bare package version when no suffix is set', () => {
    const { version, latest } = build({ COMMIT_HASH: 'abcdef1234567890' });
    assert.equal(version, pkg);
    assert.equal(latest, pkg);
  });

  it('should append the suffix and the short commit as semver build metadata', () => {
    const { version, latest, commit } = build({ VERSION_SUFFIX: 'main', COMMIT_HASH: 'abcdef1234567890' });
    assert.equal(version, `${pkg}+main.abcdef1`);
    assert.equal(commit, 'abcdef1234567890');
    // The update check compares this one against GitHub's latest release, so it
    // must stay the plain package version.
    assert.equal(latest, pkg);
  });

  it('should keep only characters that are valid in semver build metadata', () => {
    const { version } = build({ VERSION_SUFFIX: 'Main/feature branch', COMMIT_HASH: 'abcdef1234567890' });
    assert.equal(version, `${pkg}+Main-feature-branch.abcdef1`);
  });
});
