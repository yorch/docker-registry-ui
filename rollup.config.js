import riot from 'rollup-plugin-riot';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { emptyDirectories } from 'rollup-plugin-app-utils';
import { babel } from '@rollup/plugin-babel';
import scss from 'rollup-plugin-scss';
import serve from 'rollup-plugin-serve';
import html from '@rollup/plugin-html';
import htmlUseref from './rollup/html-useref.js';
import json from '@rollup/plugin-json';
import copy from 'rollup-plugin-copy';
import copyTransform from './rollup/copy-transform.js';
import license from './rollup/license.js';
import checkOutput from './rollup/check-output.js';
import importSVG from './rollup/import-svg.js';
import mockRegistryPlugin from './rollup/mock-registry-plugin.js';
import { DEFAULT_MOCK_PORT } from './dev/mock-registry/server.js';
import { devConfig, applyDevConfig } from './rollup/dev-config.js';
import fs from 'fs';
import { execFileSync } from 'child_process';
const version = JSON.parse(fs.readFileSync('./package.json', 'utf-8')).version;

const useServe = process.env.ROLLUP_SERVE === 'true';
const output = useServe ? '.serve' : 'dist';

// Setting REGISTRY_URL says you have a registry of your own, so the mock stays
// out of the way. Leaving it unset gets you one, which is what makes a bare
// `npm start` show a populated interface.
const mockPort = Number(process.env.MOCK_REGISTRY_PORT) || DEFAULT_MOCK_PORT;
const useMockRegistry = useServe && !process.env.REGISTRY_URL;
const serveConfig = devConfig({
  ...process.env,
  REGISTRY_URL: process.env.REGISTRY_URL || `http://localhost:${mockPort}`,
});

const getVersion = (version) => {
  const parts = version.split('.').map((e) => parseInt(e));
  if (useServe || process.env.DEVELOPMENT_BUILD) {
    parts[1]++;
    parts[2] = 0;
    return parts.join('.') + (useServe ? '-dev' : `-${process.env.DEVELOPMENT_BUILD.slice(0, 10)}`);
  }
  return version;
};

/*
 * The commit the bundle was built from, so a running container can be traced
 * back to its source.
 *
 * COMMIT_HASH comes first because it is the only source the image builds have:
 * `.dockerignore` does not allowlist `.git`, so git is unavailable inside the
 * build stage and the workflows pass the SHA as a build argument instead. The
 * git fallback covers local builds. Neither being available is normal -- a
 * tarball checkout, say -- and the footer simply omits the hash.
 *
 * Always written, even empty: `.version.json` is consumed as a named ESM import
 * and an absent key is a build-time "missing export" error, not an undefined.
 */
const getCommitHash = () => {
  if (process.env.COMMIT_HASH) {
    return process.env.COMMIT_HASH.trim();
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    return '';
  }
};

fs.writeFileSync(
  '.version.json',
  JSON.stringify({ version: getVersion(version), latest: version, commit: getCommitHash() }),
);

const plugins = [
  riot(),
  json(),
  importSVG(),
  nodeResolve(),
  commonjs(),
  scss({ fileName: `docker-registry-ui.css`, outputStyle: 'compressed' }),
  babel({ babelHelpers: 'bundled', presets: [['@babel/env', { useBuiltIns: 'usage', corejs: { version: '2' } }]] }),
  copy({
    targets: [
      { src: 'src/fonts', dest: `${output}` },
      { src: '.version.json', dest: `${output}`, rename: 'version.json' },
      { src: 'src/images/*', dest: `${output}/images`, transform: copyTransform },
    ],
  }),
];

if (useServe) {
  if (useMockRegistry) {
    plugins.push(mockRegistryPlugin({ port: mockPort, latency: Number(process.env.MOCK_LATENCY_MS) || 0 }));
  }
  plugins.push(serve({ host: 'localhost', port: 8000, contentBase: [output, './'] }));
} else {
  plugins.push(terser({ format: { preamble: license } }));
}

export default [
  {
    input: { 'docker-registry-ui': 'src/index.js' },
    output: {
      dir: output,
      name: 'DockerRegistryUI',
      format: 'iife',
      sourcemap: useServe,
    },
    plugins: [emptyDirectories(output)].concat(
      plugins,
      html({
        template: () => {
          const markup = htmlUseref('./src/index.html', { developement: useServe, production: !useServe });
          // Only in serve mode: a production build must ship the placeholders
          // untouched for the container entrypoint to substitute at startup.
          return useServe ? applyDevConfig(markup, serveConfig) : markup;
        },
      }),
      checkOutput(output),
    ),
  },
];
