/*
 * The product is called Registry Explorer. Renaming it took two passes: the
 * first missed every lowercase variant ("docker registry ui"), and the one that
 * actually reached a user's screen was `REGISTRY_TITLE: "Docker registry UI"`
 * in the Kubernetes example -- capital D, lowercase r, invisible to a
 * case-sensitive search.
 *
 * This walks the tracked files rather than the filesystem so build output and
 * node_modules cannot trip it.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// `docs/` holds dated design records, including one that explicitly decided not
// to rename at the time. Rewriting them would falsify the history.
const EXEMPT = [/^docs\//];

// Identifiers, not prose: the repo, the image, the custom element and the env
// var keep their original names on purpose, because deployments depend on them.
const IDENTIFIER = /docker-registry-ui|DOCKER_REGISTRY_UI/;

const OLD_NAME = /docker\s+registry\s+(ui|user interface)/i;

const trackedFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32 })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !EXEMPT.some((pattern) => pattern.test(file)));

describe('product name', () => {
  it('should not leave the old name anywhere outside the dated design docs', () => {
    const offenders = [];
    for (const file of trackedFiles()) {
      let text;
      try {
        text = readFileSync(join(root, file), 'utf-8');
      } catch (_error) {
        continue; // binary or unreadable; nothing to match
      }
      text.split('\n').forEach((line, index) => {
        // Strip the identifiers first so `ghcr.io/yorch/docker-registry-ui`
        // and `DOCKER_REGISTRY_UI_TITLE` do not read as the product name.
        if (OLD_NAME.test(line.replace(new RegExp(IDENTIFIER, 'g'), ''))) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `The product is "Registry Explorer". Found the old name in:\n  ${offenders.join('\n  ')}`,
    );
  });
});
