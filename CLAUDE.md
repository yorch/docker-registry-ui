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

## Build gotchas

- **`dist/` is build output and is not committed.** The Docker images build it in a
  multi-stage build. Nothing else needs it — the GitHub Pages workflow only renders
  the README landing page and does not build or publish the bundle.
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

## Licensing

AGPL-3.0. Every source file carries the original author's copyright line; keep it.
Add to the header, never replace it.
