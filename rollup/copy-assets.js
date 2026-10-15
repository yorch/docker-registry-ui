/*
 * Copies static assets next to the bundle once it has been written.
 *
 * Replaces rollup-plugin-copy, whose dependency chain (globby, fast-glob,
 * micromatch, braces) was most of what `npm audit` reported, for the three
 * fixed copies this build needs. Each target is `{ src, dest, rename?, transform? }`
 * and behaves as it did there:
 *
 * - `dest` is a directory; the source keeps its base name inside it unless
 *   `rename` (a string) replaces it.
 * - `src` is a file, a directory (copied recursively, under its own name), or
 *   `some/dir/*`, the files directly inside a directory.
 * - `transform(contents, name)` receives a file's contents as a Buffer plus its
 *   base name and returns the string or Buffer to write instead. Files only.
 *
 * Runs in writeBundle, which fires after every rebuild in watch mode, and which
 * comes after the buildStart in which emptyDirectories wipes the output.
 */

import fs from 'node:fs';
import path from 'node:path';

const expand = (src) => {
  if (!src.endsWith('/*')) {
    return [src];
  }
  const dir = src.slice(0, -2);
  return fs.readdirSync(dir).map((name) => path.join(dir, name));
};

const copyOne = (src, dest, { rename, transform }) => {
  const target = path.join(dest, rename ?? path.basename(src));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!transform) {
    fs.cpSync(src, target, { recursive: true });
    return;
  }
  if (!fs.statSync(src).isFile()) {
    throw new Error(`"transform" works only on files: '${src}' must be a file`);
  }
  fs.writeFileSync(target, transform(fs.readFileSync(src), path.basename(src)));
};

export default function copyAssets({ targets = [] } = {}) {
  return {
    name: 'copy-assets',
    writeBundle() {
      for (const { src, dest, ...options } of targets) {
        for (const file of expand(src)) {
          copyOne(file, dest, options);
        }
      }
    },
  };
}
