# CLAUDE.md

A web UI for private Docker registries. Riot.js 9 SPA bundled by Rollup, served
by nginx from a container. Fork of Joxit/docker-registry-ui — see README.

## Commands

- `npm ci` — install from the lockfile
- `npm start` — dev server on http://localhost:8000 (writes to `.serve/`, not `dist/`)
- `npm run build` — production bundle into `dist/`
- `npm test` — mocha suites in `test/`
- `npm run lint` — `biome check .`
- `npm run format` — `biome format --write .`

## Conventions

- Components are Riot single-file components (`.riot`) under `src/components/`.
- **Biome does not format `.riot` files, and neither did Prettier before it.**
  Neither tool can parse Riot SFCs. Format them by hand, matching surrounding style.
- Styles are SCSS under `src/styles/`, using a dependency-free design system
  (`tokens.scss`, `base.scss`, `layout.scss`, `components.scss`).

## Build gotchas

- **`dist/` is build output and is not committed.** The Docker images build it in a
  multi-stage build; the GitHub Pages workflow builds it at deploy time for the demo.
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
