# CLAUDE.md

A web UI for private Docker registries. Riot.js 9 SPA bundled by Rollup, served
by nginx from a container. Fork of Joxit/docker-registry-ui — see README.

## Commands

- `npm ci` — install from the lockfile
- `npm start` — dev server on http://localhost:8000 (writes to `.serve/`, not `dist/`).
  With no `REGISTRY_URL` set it also starts a mock registry on port 5555, so the UI has
  something to browse without a real registry. See `Developing.md`.
- `npm run build` — production bundle into `dist/`
- `npm test` — mocha suites in `test/`
- `npm run build:site` — the project site (GitHub Pages) into `site/_build`
- `npm run lint` — `biome check .`
- `npm run format` — `biome format --write .`

## Conventions

- Components are Riot single-file components (`.riot`) under `src/components/`.
- **Biome does not format `.riot` files, and neither did Prettier before it.**
  Neither tool can parse Riot SFCs. Format them by hand, matching surrounding style.
- `.riot` components are unit-testable even though no tool formats them: `test/setup/register.js`
  (loaded via `.mocharc.json`'s `node-option`) registers `test/setup/riot-loader.js`, a Node ESM
  loader hook that compiles `.riot` files with `@riotjs/compiler` on import, plus a jsdom
  `document`. Tests can mount and drive components directly, not just plain modules.
- Styles are SCSS under `src/styles/`, using a dependency-free design system
  (`tokens.scss`, `base.scss`, `layout.scss`, `components.scss`).
- `src/scripts/cache-request.js` and `src/scripts/request-pool.js` back the registry HTTP layer:
  a sessionStorage-backed response cache (digest-addressed manifests/blobs cached indefinitely,
  tag lists and tag-addressed manifests cached for 30s) and a 6-request concurrency pool shared
  by the catalog's tag counts and the tag list's per-row manifest/blob fetches.

## The project site

- `site/` builds the GitHub Pages site — plain static HTML, no Jekyll and no SSG.
  `site/static/` is copied verbatim; `site/build.mjs` renders the pages.
- **`site/docs.html` is generated from `README.md`.** The README is the canonical
  reference, so the docs page is assembled from the sections named in `DOC_SECTIONS`
  in `site/build.mjs`. Rename a `##` heading in the README and the build fails loudly
  rather than silently dropping that section — update `DOC_SECTIONS` to match.
- Heading anchors use GitHub's own slug algorithm on purpose. The app's error page
  links to `#faq` and `#available-options`, so a different scheme would break those
  links for anyone who lands on the hosted docs instead of the README.
- The site reuses the colour, radius and motion tokens from `src/styles/tokens.scss`
  and the same `data-theme` contract as the app, but defines its own larger type
  scale — the app's stops at 28px, which is far too small for a page headline.

## Build gotchas

- **`dist/` is build output and is not committed.** The Docker images build it in a
  multi-stage build. The GitHub Pages workflow does not touch it — the project site
  is a separate build (`npm run build:site`) that does not include the app bundle.
- **`dev/` is a build-time dependency, not just dev tooling.** `rollup.config.js` imports
  `rollup/mock-registry-plugin.js` at module load, which imports `dev/mock-registry/server.js`.
  Rollup therefore cannot start without `dev/` present — production builds included. Both
  Dockerfiles `COPY dev/` into the build stage and `.dockerignore` allowlists it. If you add
  another top-level directory that `rollup.config.js` reaches, it needs the same treatment or
  the image build fails while `npm run build` still works locally.
- **`dist/index.html` ships with literal `${REGISTRY_URL}`-style placeholders.**
  `bin/90-docker-registry-ui.sh` runs as an nginx entrypoint hook and substitutes them
  with `sed` from environment variables at container start. A change that pre-substitutes
  or strips those placeholders silently breaks every configuration option.
  When adding a new env-var option, you must add a matching `sed` line to that script.
- `rollup.config.js` reads `version` from `package.json` and writes `dist/version.json`.
  Setting `DEVELOPMENT_BUILD` or running the dev server bumps the minor version and
  appends a suffix.
- **`version.json` also carries the `commit` the bundle was built from**, which the
  app footer links to. It comes from `COMMIT_HASH` if set, else `git rev-parse HEAD`,
  else the empty string. The image builds only ever get the first: `.dockerignore`
  does not allowlist `.git`, so both Dockerfiles declare `ARG COMMIT_HASH` and all
  four `build-push-action` steps in `main.yml`/`release.yml` pass `${{ github.sha }}`.
  Add the build arg to any new image build, or its footer silently loses the hash.
- **`.version.json` is consumed as a named ESM import**, so every key it can ever
  have must always be written. A key omitted because its value was undefined is a
  build-time "missing export" error, not an `undefined` at runtime.
- **Riot template expressions resolve against the component, not module scope.**
  A value imported at the top of a `.riot` file is not reachable from `{ … }` in the
  template until it is also a property on the `export default` object — the compiler
  emits `e => e.name`, so the identifier silently reads as `undefined` and tree-shaking
  then drops the import entirely. `version`, `latest` and `commit` are exposed this way.

## Licensing

AGPL-3.0. Every source file carries the original author's copyright line; keep it.
Add to the header, never replace it.
