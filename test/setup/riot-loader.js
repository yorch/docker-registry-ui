/*
 * Node ESM loader hook that compiles `.riot` single-file components on import,
 * so mocha can exercise components the same way rollup-plugin-riot builds them.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, registerPreprocessor } from '@riotjs/compiler';

// Components carry <style> blocks written in scss. The tests assert behaviour,
// not styling, so drop the stylesheet rather than pulling sass into the loader.
registerPreprocessor('css', 'scss', () => ({ code: '', map: null }));

// Components import their modules without a file extension, which the rollup
// resolver accepts but Node's ESM resolver does not. Only used as a fallback,
// so a genuinely missing module still reports the specifier that was asked for.
export async function resolve(specifier, context, nextResolve) {
  // `.version.json` is written by rollup.config.js and is gitignored, so a
  // fresh checkout has none. Tests of the app shell get a fixed stand-in.
  if (specifier.endsWith('/.version.json')) {
    return { url: 'test-stub:version', shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url === 'test-stub:version') {
    const source = 'export const version = "0.0.0-test"; export const latest = "0.0.0-test"; export const commit = "";';
    return { format: 'module', shortCircuit: true, source };
  }
  // rollup's import-svg plugin turns an svg import into a function returning a
  // parsed document. Tests never look at the artwork, so a stub is enough.
  if (url.endsWith('.svg')) {
    const source = 'export default () => ({ firstElementChild: { outerHTML: "<svg></svg>" } });';
    return { format: 'module', shortCircuit: true, source };
  }
  if (!url.endsWith('.riot')) {
    return nextLoad(url, context);
  }
  const path = fileURLToPath(url);
  const source = await readFile(path, 'utf8');
  const { code } = compile(source, { file: path });
  return { format: 'module', shortCircuit: true, source: code };
}
