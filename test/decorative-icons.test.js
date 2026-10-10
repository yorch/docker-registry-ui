/*
 * Material Symbols are ligature text: without aria-hidden a screen reader
 * announces "send", "folder", "sell" inside the link or button that holds the
 * icon. Every icon element in a component must be hidden from the accessibility
 * tree; the control around it carries the accessible name.
 */
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const riotFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? riotFiles(join(dir, e.name)) : e.name.endsWith('.riot') ? [join(dir, e.name)] : [],
  );

describe('decorative icons', () => {
  it('should mark every material-icons element aria-hidden', () => {
    const offenders = [];
    let seen = 0;
    for (const file of riotFiles(new URL('../src/components', import.meta.url).pathname)) {
      for (const [tag] of readFileSync(file, 'utf8').matchAll(/<i\b[^>]*material-icons[^>]*>/g)) {
        seen++;
        if (!/aria-hidden="true"/.test(tag)) {
          offenders.push(`${file}: ${tag}`);
        }
      }
    }
    assert.ok(seen > 20, `expected to find the icons, found ${seen}`);
    assert.deepEqual(offenders, []);
  });
});
