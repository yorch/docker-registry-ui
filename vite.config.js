import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import checkOutput from './build/check-output.js';
import copyTransform from './build/copy-transform.js';
import { applyDevConfig, devConfig } from './build/dev-config.js';
import htmlUseref from './build/html-useref.js';
import importSVG from './build/import-svg.js';
import license from './build/license.js';
import riot from './build/riot.js';
import { createMockRegistry, DEFAULT_MOCK_PORT } from './dev/mock-registry/server.js';

// Where the generated version file lives. Only the build test overrides it, so that
// running the suite does not overwrite the real file a dev server may have loaded.
const versionFile = path.resolve(process.env.VERSION_FILE || '.version.json');

const version = JSON.parse(fs.readFileSync('./package.json', 'utf-8')).version;

/*
 * The version the footer shows. A tagged release is the bare package version.
 * VERSION_SUFFIX marks every other image (the main-branch one passes `main`), so
 * "3.4.0" is not shown for code that is newer than the 3.4.0 release:
 * `3.4.0+main.abcdef1`, which is semver build metadata. Anything outside
 * [0-9A-Za-z.-] becomes `-`. `latest` (written next to it) stays the package
 * version because the update check compares that one with GitHub's latest release.
 */
const getVersion = (version, serve, commit) => {
  const parts = version.split('.').map((e) => parseInt(e, 10));
  if (serve || process.env.DEVELOPMENT_BUILD) {
    parts[1]++;
    parts[2] = 0;
    return parts.join('.') + (serve ? '-dev' : `-${process.env.DEVELOPMENT_BUILD.slice(0, 10)}`);
  }
  const suffix = (process.env.VERSION_SUFFIX || '').trim().replace(/[^0-9A-Za-z.-]/g, '-');
  if (suffix) {
    return `${version}+${suffix}${commit ? `.${commit.slice(0, 7)}` : ''}`;
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

// import-svg, made to win over Vite's built-in asset handling of `.svg`, which
// would otherwise load the file as a URL string before the transform runs.
const svgAsDom = () => {
  const inner = importSVG();
  return {
    name: 'import-svg',
    enforce: 'pre',
    load(id) {
      if (path.extname(id) !== '.svg') return null;
      return inner.transform(fs.readFileSync(id, 'utf-8'), id);
    },
  };
};

// Production only: emits index.html, the images and version.json. index.html is
// emitted as a plain asset rather than going through Vite's HTML pipeline, so the
// `${VAR}` placeholders reach dist/ untouched for the container entrypoint to
// substitute at startup. Fonts are not copied here: Vite emits them from the
// `url()`s in the stylesheet.
const staticOutput = () => ({
  name: 'static-output',
  apply: 'build',
  generateBundle() {
    const html = htmlUseref('./src/index.html', { developement: false, production: true });
    this.emitFile({ type: 'asset', fileName: 'index.html', source: html });
    this.emitFile({ type: 'asset', fileName: 'version.json', source: fs.readFileSync(versionFile) });
    for (const name of fs.readdirSync('src/images')) {
      const source = copyTransform(fs.readFileSync(path.join('src/images', name)), name);
      this.emitFile({ type: 'asset', fileName: `images/${name}`, source });
    }
  },
});

// Dev only: serves the useref'd index.html with the dev configuration
// substituted and the bundle tags swapped for the module entry, and boots the
// mock registry in this process, so there is no second command to keep alive and
// nothing left listening when the dev server exits.
const devServer = ({ config, mock }) => ({
  name: 'dev-index',
  apply: 'serve',
  async configureServer(server) {
    if (mock) {
      try {
        const registry = await createMockRegistry(mock);
        console.log(`\x1b[32mmock registry\x1b[39m listening on ${registry.url}`);
        server.httpServer?.once('close', () => registry.close());
      } catch (error) {
        console.warn(
          `could not start the mock registry on port ${mock.port}: ${error.message}. ` +
            `Set MOCK_REGISTRY_PORT to use another port, or REGISTRY_URL to point at a real registry.`,
        );
      }
    }
    server.middlewares.use(async (req, res, next) => {
      const url = req.url.split('?')[0];
      if (url !== '/' && url !== '/index.html') return next();
      let html = applyDevConfig(htmlUseref('./src/index.html', { developement: true, production: false }), config);
      html = html
        .replace('<link href="docker-registry-ui.css" rel="stylesheet" type="text/css">', '')
        .replace(
          '<script src="docker-registry-ui.js"></script>',
          '<script type="module" src="/src/index.js"></script>',
        );
      html = await server.transformIndexHtml(req.url, html);
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    });
  },
});

export default defineConfig(({ command }) => {
  const serve = command === 'serve';
  const commit = getCommitHash();
  fs.writeFileSync(
    versionFile,
    JSON.stringify({ version: getVersion(version, serve, commit), latest: version, commit }),
  );
  // Setting REGISTRY_URL says you have a registry of your own, so the mock stays
  // out of the way. Leaving it unset gets you one, which is what makes a bare
  // `npm start` show a populated interface.
  const mockPort = Number(process.env.MOCK_REGISTRY_PORT) || DEFAULT_MOCK_PORT;
  return {
    root: '.',
    base: './',
    publicDir: false,
    appType: 'custom',
    plugins: [
      {
        // src imports `.version.json` by name; point that at the file written above.
        name: 'version-file',
        enforce: 'pre',
        resolveId: (source) => (source.endsWith('.version.json') ? versionFile : null),
      },
      riot(),
      svgAsDom(),
      staticOutput(),
      { ...checkOutput(), apply: 'build' },
      devServer({
        config: devConfig({ ...process.env, REGISTRY_URL: process.env.REGISTRY_URL || `http://localhost:${mockPort}` }),
        mock: process.env.REGISTRY_URL ? null : { port: mockPort, latency: Number(process.env.MOCK_LATENCY_MS) || 0 },
      }),
    ],
    server: { host: 'localhost', port: 8000, strictPort: true },
    // The dependency scanner cannot see through .riot files, so without this the
    // first page load discovers these late and Vite force-reloads the page.
    optimizeDeps: { entries: ['src/index.js'], include: ['riot', '@riotjs/observable', '@riotjs/route'] },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // The browser floor documented in the README. Vite's default would raise it
      // to Chrome 111 / Firefox 114 / Safari 16.4. `es2020` is there so the
      // minifier does not introduce ES2021 syntax (it otherwise emits `&&=`, which
      // the floor does support) and the README's "ES2020 syntax" stays literally true.
      target: ['es2020', 'chrome93', 'firefox92', 'safari15.4'],
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      reportCompressedSize: false,
      rolldownOptions: {
        input: { 'docker-registry-ui': 'src/index.js' },
        output: {
          format: 'iife',
          name: 'DockerRegistryUI',
          entryFileNames: '[name].js',
          assetFileNames: (asset) => {
            const name = asset.names?.[0] ?? '';
            if (name.endsWith('.css')) return 'docker-registry-ui.css';
            if (/\.(ttf|woff2?)$/.test(name)) return 'fonts/[name][extname]';
            return 'assets/[name][extname]';
          },
          postBanner: license,
          // Vite drops legal comments when minifying; keep the third-party licences.
          comments: { legal: true },
          // Without this the IIFE loses the "use strict" it had under Rollup, and
          // production would run sloppy while the dev server's ES modules run strict.
          strict: true,
        },
      },
    },
  };
});
