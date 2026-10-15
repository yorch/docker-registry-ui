import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import copyAssets from '../rollup/copy-assets.js';

describe('copy-assets rollup plugin', () => {
  let root;
  const write = (file, contents) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const run = async (targets) => {
    const plugin = copyAssets({ targets });
    await plugin.writeBundle();
  };

  beforeEach(() => {
    fs.mkdirSync('tmp', { recursive: true });
    root = fs.mkdtempSync(path.join('tmp', 'copy-assets-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should copy a directory into dest under its own name', async () => {
    write('src/fonts/a.ttf', 'A');
    write('src/fonts/nested/b.woff', 'B');
    await run([{ src: path.join(root, 'src/fonts'), dest: path.join(root, 'out') }]);
    assert.strictEqual(read('out/fonts/a.ttf'), 'A');
    assert.strictEqual(read('out/fonts/nested/b.woff'), 'B');
  });

  it('should copy a single file, renaming it', async () => {
    write('.version.json', '{"v":1}');
    await run([{ src: path.join(root, '.version.json'), dest: path.join(root, 'out'), rename: 'version.json' }]);
    assert.strictEqual(read('out/version.json'), '{"v":1}');
    assert.ok(!fs.existsSync(path.join(root, 'out/.version.json')));
  });

  it('should expand a trailing /* to the files of a directory, flat into dest', async () => {
    write('src/images/one.svg', '1');
    write('src/images/two.png', '2');
    await run([{ src: path.join(root, 'src/images/*'), dest: path.join(root, 'out/images') }]);
    assert.strictEqual(read('out/images/one.svg'), '1');
    assert.strictEqual(read('out/images/two.png'), '2');
  });

  it('should run the transform with the contents as a Buffer and the file name', async () => {
    write('src/images/one.svg', 'x');
    write('src/images/two.png', 'y');
    const calls = [];
    const transform = (contents, name) => {
      calls.push([Buffer.isBuffer(contents), name]);
      return `${name}:${contents.toString()}`;
    };
    await run([{ src: path.join(root, 'src/images/*'), dest: path.join(root, 'out/images'), transform }]);
    assert.deepStrictEqual(calls.sort(), [
      [true, 'one.svg'],
      [true, 'two.png'],
    ]);
    assert.strictEqual(read('out/images/one.svg'), 'one.svg:x');
    assert.strictEqual(read('out/images/two.png'), 'two.png:y');
  });

  it('should create missing destination directories and overwrite on a second run', async () => {
    write('a.txt', 'first');
    const target = { src: path.join(root, 'a.txt'), dest: path.join(root, 'deep/er/out') };
    await run([target]);
    write('a.txt', 'second');
    await run([target]);
    assert.strictEqual(read('deep/er/out/a.txt'), 'second');
  });

  it('should fail loudly when a source does not exist', async () => {
    await assert.rejects(run([{ src: path.join(root, 'missing'), dest: path.join(root, 'out') }]));
  });
});
