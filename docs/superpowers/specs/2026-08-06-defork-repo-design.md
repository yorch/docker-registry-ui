# De-fork: make `yorch/docker-registry-ui` a standalone project

**Date:** 2026-08-06
**Status:** Approved design, pending implementation plan

## Problem

This repo is a fork of [`Joxit/docker-registry-ui`](https://github.com/Joxit/docker-registry-ui) with one
substantial local change on top (`e74bc2a`, the SaaS redesign). It is still wired to upstream in ways that are
variously broken, misleading, or leaky:

- CI pushes images to Docker Hub `joxit/docker-registry-ui` using secrets this repo does not have, so every push
  to `main` fails.
- `release.yml` uses `::set-output`, which GitHub removed in 2023, so releases are dead regardless of secrets.
- The running app polls upstream's GitHub releases and tells operators to `docker pull joxit/docker-registry-ui`.
- `_config.yml` carries upstream's Google Analytics property and a `remote_theme` pointing at upstream's repo.
- Metadata (author, repository, maintainer labels, README badges) all describe upstream.

There is no intent to contribute back upstream, and no intent to merge upstream changes in. This project is now
its own thing.

## Goals

1. Nothing at build time, release time, or runtime references upstream except as **attribution**.
2. Images publish to GHCR under `yorch/` with no manually-created secrets.
3. AGPL-3.0 obligations are fully met.
4. Repo hygiene matches the owner's standing preferences (Biome, committed lockfile, no generated files in git).

## Non-goals

- Renaming the product. It stays "Docker Registry UI".
- Preserving merge-ability with upstream. We are fully diverging; future upstream fixes, if wanted, get
  cherry-picked by hand.
- Changing application behavior or features beyond removing upstream coupling.

## Decisions

| Question | Decision |
|---|---|
| Upstream relationship | Fully diverge |
| Image registry | GHCR only (`ghcr.io/yorch/docker-registry-ui`) |
| Product name | Unchanged — "Docker Registry UI" |
| Version line | Continue upstream's; this work ships as `2.7.0` |
| Formatter | Biome 2.5.x replaces Prettier |
| `dist/` | Untracked; built inside a multi-stage Docker build |
| Lockfile | `package-lock.json` committed; CI uses `npm ci` |
| GitHub Pages | Kept and rewritten for this repo (not deleted) |
| Build platforms | `linux/amd64` + `linux/arm64` only |
| Sequencing | Atomic commits on one branch, single PR |

## Design

### A. Identity & metadata

- `package.json`: `repository.url` → `https://github.com/yorch/docker-registry-ui.git`; `author` → `Jorge Barnaby
  (yorch)`; `version` → `2.7.0`; add `engines.node` (`>=22`); `license` stays `AGPL-3.0`.

**Node version, used consistently everywhere:** CI runs Node **24**, the Docker build stage uses
`node:24-alpine`, and `engines.node` declares `>=22` as the supported floor.
- `Dockerfile`, `debian.dockerfile`: `LABEL maintainer` → repo owner. Add OCI labels:
  `org.opencontainers.image.source`, `.licenses`, `.description`, `.title`.
- `src/index.html`: remove `twitter:site` meta; update OG/canonical URLs to this repo's Pages URL.

### B. CI/CD on GHCR

Three workflows, all replaced.

**`ci.yml`** — triggers: `pull_request`, `push` to branches other than `main`.
`setup-node@v4` (node 24, npm cache) → `npm ci` → `biome ci` → `npm test` → `npm run build`
(with `DEVELOPMENT_BUILD: ${{ github.sha }}`).

**`main.yml`** — trigger: `push` to `main`.
Same gates, then buildx build+push:
- `ghcr.io/yorch/docker-registry-ui:main` (from `Dockerfile`)
- `ghcr.io/yorch/docker-registry-ui:main-debian` (from `debian.dockerfile`)

**`release.yml`** — trigger: `push` tags `['*']`. Existing tags are bare semver (`2.6.0`, no `v` prefix); this
preserves that convention.
Same gates, then:
- Derive major/minor/patch tags via `$GITHUB_OUTPUT` (replacing removed `::set-output`).
- Release notes via `softprops/action-gh-release` with `generate_release_notes: true`
  (replaces archived `actions/create-release@v1` and upstream's `kokai` tool).
- Push `:latest`, `:2`, `:2.7`, `:2.7.0` and the matching `-debian` tags.

Shared details:
- Auth: `docker/login-action@v3` against `ghcr.io` with `${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}`.
  Workflow-level `permissions: { contents: write, packages: write }`. **No manually-created secrets.**
- Actions pinned to current majors: `checkout@v4`, `setup-node@v4`, `setup-qemu-action@v3`,
  `setup-buildx-action@v3`, `build-push-action@v6`.
- Platforms: `linux/amd64,linux/arm64`. Upstream's `386`, `arm/v6`, `arm/v7`, `ppc64le`, `s390x` are dropped.
- Enable GitHub Actions cache for buildx layers (`cache-from`/`cache-to: type=gha`) to offset the new in-image
  npm build.

### C. Runtime de-coupling

- `src/components/version-notification.riot`
  - Poll URL → `https://api.github.com/repos/yorch/docker-registry-ui/releases/latest`.
  - Pull command in dialog → `ghcr.io/yorch/docker-registry-ui:{ state.tag_name }`.
  - Behavior is otherwise unchanged and still gated by `ENABLE_VERSION_NOTIFICATION`.
- `src/components/error-page.riot`: the five links to `joxit.dev` FAQ / options and upstream issues
  (`#277`, `#306`, milestone 6, `#39`) become anchors into this repo's README, or plain prose where no
  equivalent section exists. No dead links may remain.
- `src/components/docker-registry-ui.riot:123-124`: footer GitHub link → `github.com/yorch/docker-registry-ui`;
  LICENSE link → this repo's `LICENSE`.

### D. Docker build

Both `Dockerfile` and `debian.dockerfile` become multi-stage:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine-slim
# ... existing ENV / COPY nginx conf / entrypoint ...
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY favicon.ico /usr/share/nginx/html/
RUN chown -R nginx:nginx ...
```

- `dist/` is `git rm -r --cached`'d and added to `.gitignore`.
- `.dockerignore` rewritten: deny `dist`, allow `src`, `rollup`, `rollup.config.js`, `package.json`,
  `package-lock.json`, `bin`, `nginx`, `favicon.ico`.
- Delete `arm32v7.dockerfile` and `arm64v8.dockerfile` — referenced by no workflow, doc, or example.

**Constraint that must not regress:** `bin/90-docker-registry-ui.sh` performs runtime `sed` substitution of
`${REGISTRY_URL}`-style placeholders in the served `index.html`. The build stage must emit `dist/index.html`
with those placeholders intact, exactly as the committed `dist/` does today.

### E. Tooling

- Add `@biomejs/biome@^2.5.7` and `biome.json` configured to match the current Prettier behavior:
  single quotes, 2-space indent, 120 print width, preserve quote props.
- Biome formats/lints `**/*.js` and `**/*.json`. **Excluded:** `**/*.riot` (Biome cannot parse Riot SFCs) and
  `src/index.html`. This matches today's reality — Prettier already skipped `.riot` — minus `src/index.html`,
  which loses formatting.
- Remove `prettier` and `.prettierrc`. Replace `format` / `format-html` / `format-js` scripts with
  `format` (`biome format --write`) and `lint` (`biome check`).
- Remove `package-lock.json` from `.gitignore`, generate and commit it.

### F. Pruning

Delete:
- `arm32v7.dockerfile`, `arm64v8.dockerfile`
- `CONTRIBUTORS.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`
- `docker-registry-ui.gif` (3.6 MB) — unreferenced by any file in this repo; the README's preview links to
  upstream's *hosted* copy, not this one

**Screenshot handling (single source of truth).** `screenshot.png` is **replaced, not deleted**. The committed
one shows upstream's pre-redesign UI, and the README's preview currently hot-links
`raw.github.com/Joxit/docker-registry-ui/main/docker-registry-ui.gif` — upstream's asset, showing the old UI.
Both are wrong post-redesign. One fresh `screenshot.png` of the redesigned UI is captured and committed, and
serves both the README preview and the Pages `og:image`. Capturing it requires running the app against a
populated local registry (`examples/populate-registry` provides one) — an explicit step in the docs commit, not
an assumption.
- `examples/issue-20`, `examples/issue-73`, `examples/issue-75`, `examples/issue-88`, `examples/issue-116`,
  `examples/pr-219` — all named after upstream issue numbers and meaningless here

Keep: `examples/{ui-as-proxy,ui-as-standalone,traefik,kubernetes,helm,read-only-auth,proxy-headers,
token-auth-keycloak,populate-registry,electron}`, updating any `joxit/docker-registry-ui` image references to
`ghcr.io/yorch/docker-registry-ui`.

Rewrite `CONTRIBUTING.md` down to a short note: personal fork, issues/PRs welcome but no guarantees, link
upstream for the original project.

### G. GitHub Pages

Kept, not deleted. `_config.yml` rewritten:
- `url` → this repo's Pages URL
- `google_analytics` → **removed** (upstream's `G-T158HYBVZ2` must not remain)
- `remote_theme` → a public theme (`pages-themes/cayman`) instead of `joxit/joxit.github.io`
- `author` → repo owner; `twitter` / `instagram` blocks removed
- `defaults.image` → stays `/screenshot.png`, which by then is the fresh capture described in §F

`index.md` symlink to `README.md` is kept — that is what renders the Pages landing page.

`demo/index.html` rewritten:
- Copyright header keeps Joxit's line and adds ours
- OG/canonical/twitter meta → this repo
- **`default-registries` no longer points at `https://joxit.dev/docker-registry-demo`.** The demo ships with no
  default registry; the visitor enters one. Hosting our own demo registry is possible future work, explicitly
  out of scope here.
- The `raw.githubusercontent.com/Joxit/...` fallback reference is removed

Pages is currently disabled on the repo. Enabling it is a manual, post-merge step for the owner; nothing in this
work depends on it being on.

### H. Documentation

- `README.md` rewritten:
  - Badges → this repo's stars/release + GHCR package; upstream sponsor and Artifact Hub badges removed
  - Preview image → local `./screenshot.png` (the fresh capture from §F), replacing the hot-linked upstream gif
  - All `docker pull` / compose examples → `ghcr.io/yorch/docker-registry-ui`
  - Supported-tags section updated to the GHCR tag scheme (no `master` aliases)
  - **New "Fork of Joxit/docker-registry-ui" section** near the top with a link to upstream
  - **New "Changes from upstream" section** enumerating the SaaS redesign, riot-mui removal, async tag counts,
    GHCR publishing, Biome, and the multi-stage build
  - The env-var / options reference table is preserved essentially as-is — it is the most valuable part of the
    document
  - Links to upstream wiki pages that have no local equivalent are kept, clearly marked as upstream docs
- Add `CLAUDE.md`: build/test/format commands, Riot SFC conventions, the multi-stage build, and the
  `bin/90-docker-registry-ui.sh` runtime-templating gotcha.
- Move `UI-UX-REVAMP.md` → `docs/UI-UX-REVAMP.md`.

### I. Licensing (AGPL-3.0 compliance — not optional)

- `LICENSE` stays byte-identical.
- Every existing `Copyright (C) 2016-2023 Jones Magloire @Joxit` header stays. Our copyright line is added
  **beneath** it, never replacing it. Affected: `rollup/license.js`, `src/index.html`,
  `src/components/docker-registry-ui.riot`, `demo/index.html`, `Dockerfile`, `debian.dockerfile`,
  and any other file carrying the header.
- AGPL §5(a) requires modified versions to carry prominent notices stating modification and date. The README
  "Fork of" + "Changes from upstream" sections satisfy this.
- The in-app footer continues to link to the AGPL license text and now to this repo's source, preserving the
  §13 network-use source offer.

## Verification

Each commit must leave the tree in a state where:

1. `npm ci && npm test` passes — the existing mocha suite (`docker-image`, `repositories`, `taglist-order`,
   `utils`) is untouched by this work and must stay green.
2. `npx biome ci .` passes (from the tooling commit onward).
3. `npm run build` produces `dist/docker-registry-ui.js`, `dist/docker-registry-ui.css`, `dist/version.json`,
   and a `dist/index.html` that still contains literal `${REGISTRY_URL}` placeholders.
4. `docker build -f Dockerfile -t drui:test .` succeeds and `docker run --rm -p 8080:80 -e REGISTRY_URL=...
   drui:test` serves a page whose placeholders were substituted by the entrypoint.
5. `grep -ri "joxit" .` (excluding `LICENSE`, `.git`, `node_modules`) returns **only** attribution: copyright
   headers, the README "Fork of" / "Changes from upstream" sections, and clearly-marked upstream doc links.
   Any other hit is a defect.

## Commit plan

One branch, one PR, atomic commits in this order:

1. `chore: untrack dist/ and commit package-lock.json`
2. `build: replace Prettier with Biome`
3. `build: multi-stage Docker builds, drop unused arm dockerfiles`
4. `ci: publish to GHCR, modernize workflows`
5. `chore: repoint project metadata and copyright to this fork`
6. `fix: point version notification and in-app links at this fork`
7. `chore: prune upstream-specific files and examples`
8. `docs: rewrite README, Pages config, and demo for this fork`

## Risks

- **Slower image builds.** npm install now runs inside the image. Mitigated by buildx GHA layer caching.
- **`src/index.html` loses formatting** under Biome. Accepted; it is one file that changes rarely.
- **Version-notification 404s** until the first GitHub release exists on this repo. The component already
  handles 404 silently by design (`version-notification.riot:71`), so this degrades cleanly.
- **README rewrite risk.** The options reference is large and load-bearing for operators; it must be carried
  over rather than re-derived.
