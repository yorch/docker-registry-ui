import { compile } from '@riotjs/compiler';

/**
 * Compiles `.riot` single-file components. A stand-in for rollup-plugin-riot,
 * which declares `rollup` as a required peer and would pull it back in; it does
 * nothing but call the compiler either way. Same options as
 * `test/setup/riot-loader.js`, so the tests build components as the bundle does.
 */
export default function riot() {
  return {
    name: 'riot',
    transform(src, id) {
      if (!id.endsWith('.riot')) return null;
      const { code, map } = compile(src, { file: id });
      return { code, map };
    },
  };
}
