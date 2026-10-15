/*
 * The product is called Registry Explorer. Renaming it took two passes: the
 * first missed every lowercase variant ("docker registry ui"), and the one that
 * actually reached a user's screen was `REGISTRY_TITLE: "Docker registry UI"`
 * in the Kubernetes example -- capital D, lowercase r, invisible to a
 * case-sensitive search.
 *
 * This walks the working tree rather than asking the VCS, so it needs no
 * external binary and no checkout metadata (a source tarball or a shallow CI
 * copy works). It skips the directories that only ever hold dependencies,
 * build output or local scratch.
 *
 * A scanner that finds nothing proves nothing, so the suite also feeds it known
 * offenders and known-clean identifiers, and checks that the walk really sees
 * the repository.
 */
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// `docs/` holds dated design records, including one that explicitly decided not
// to rename at the time. Rewriting them would falsify the history.
//
// This file exempts itself, which is not an oversight being papered over: a
// scanner for a string inevitably matches its own description of that string.
// The first version of this test failed on its own header and was merged red,
// because the e2e job was green and main is not branch-protected.
const EXEMPT = [/^docs\//, /^test\/product-name\.test\.js$/];

// Identifiers, not prose: the repo, the image, the custom element and the env
// var keep their original names on purpose, because deployments depend on them.
const IDENTIFIER = /docker-registry-ui|DOCKER_REGISTRY_UI/;

const OLD_NAME = /docker\s+registry\s+(ui|user interface)/i;

// Directories that hold dependencies, build output or local scratch, never source.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'tmp', '_site', '_build', '.idea', '.claude']);

const walk = (dir, relative = '') =>
  readdirSync(join(dir, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : walk(dir, path);
    }
    return entry.isFile() ? [path] : [];
  });

const sourceFiles = () => walk(root).filter((file) => !EXEMPT.some((pattern) => pattern.test(file)));

// Strip the identifiers first so `ghcr.io/yorch/docker-registry-ui` and
// `DOCKER_REGISTRY_UI_TITLE` do not read as the product name.
const findOldName = (text) =>
  text
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => OLD_NAME.test(line.replace(new RegExp(IDENTIFIER, 'g'), '')));

describe('product name', () => {
  describe('the scanner itself', () => {
    it('should flag every spelling of the old name', () => {
      for (const text of [
        'Docker registry UI',
        'docker registry ui',
        'DOCKER  REGISTRY\tUI',
        'Docker Registry User Interface',
      ]) {
        assert.equal(findOldName(text).length, 1, `missed: ${text}`);
      }
    });

    it('should not flag the identifiers that keep the old name on purpose', () => {
      const text = [
        'docker pull ghcr.io/yorch/docker-registry-ui:latest',
        '<docker-registry-ui></docker-registry-ui>',
        'DOCKER_REGISTRY_UI_TITLE is now APP_NAME',
        'Registry Explorer',
      ].join('\n');
      assert.deepEqual(findOldName(text), []);
    });

    it('should report the line number of an offender', () => {
      const hits = findOldName('fine\nstill fine\nthe Docker registry UI\n');
      assert.deepEqual(
        hits.map((hit) => hit.number),
        [3],
      );
    });

    it('should see the repository, so an empty walk cannot pass for a clean one', () => {
      const files = sourceFiles();
      assert.ok(files.length > 50, `only ${files.length} files found`);
      for (const expected of ['README.md', 'package.json', 'src/index.js', 'test/app-name.test.js']) {
        assert.ok(files.includes(expected), `${expected} not scanned`);
      }
      assert.ok(!files.some((file) => file.startsWith('node_modules/')), 'node_modules must be skipped');
    });
  });

  it('should not leave the old name anywhere outside the dated design docs', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      let text;
      try {
        text = readFileSync(join(root, file), 'utf-8');
      } catch (_error) {
        continue; // unreadable; nothing to match
      }
      for (const { line, number } of findOldName(text)) {
        offenders.push(`${file}:${number}: ${line.trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `The product is "Registry Explorer". Found the old name in:\n  ${offenders.join('\n  ')}`,
    );
  });
});
