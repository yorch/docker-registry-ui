# De-fork `yorch/docker-registry-ui` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sever every non-attribution tie to the upstream project `Joxit/docker-registry-ui`, so this fork builds, releases, and runs entirely on its owner's infrastructure.

**Architecture:** A Riot.js SPA bundled by Rollup into `dist/`, served by nginx from a container. Today `dist/` is committed and images publish to upstream's Docker Hub namespace. After this work, `dist/` is built inside a multi-stage Docker build and by a GitHub Pages workflow, images publish to GHCR, and all in-app links point at this repo.

**Tech Stack:** Riot.js 9, Rollup 4, SCSS, mocha, nginx, Docker buildx, GitHub Actions, Biome 2.5.x.

**Spec:** `docs/superpowers/specs/2026-08-06-defork-repo-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never remove or alter an existing `Copyright (C) 2016-2023 Jones Magloire @Joxit` line.** AGPL-3.0 requires it. New copyright lines are added *beneath* it.
- **`LICENSE` must stay byte-identical.** Never edit it.
- Owner identity, used verbatim: `Jorge Barnaby (yorch)`, `yorch@duck.com`, `https://github.com/yorch/docker-registry-ui`.
- Image name, used verbatim: `ghcr.io/yorch/docker-registry-ui`.
- Node: CI and Docker build stages use Node **24**. `engines.node` declares `>=22`.
- Build platforms, used verbatim: `linux/amd64,linux/arm64`. Never reintroduce `386`, `arm/v6`, `arm/v7`, `ppc64le`, `s390x`.
- Version for this release: `2.7.0`. Git tags are bare semver, no `v` prefix.
- Formatting: single quotes, 2-space indent, 120 print width, preserve quote props.
- `npm test` (mocha, 4 suites under `test/`) must pass at the end of every task. No task in this plan changes application logic that the suite covers.
- **`dist/index.html` must ship with literal `${REGISTRY_URL}`-style placeholders intact.** `bin/90-docker-registry-ui.sh` substitutes them with `sed` at container start. A build that pre-substitutes or strips them is broken.

## File Structure

| Path | Responsibility | Change |
|---|---|---|
| `.gitignore` | untracked paths | Modify — add `dist`, remove `package-lock.json` |
| `.gitattributes` | git file attributes | Delete — its only content is the `dist/**` stanza |
| `package-lock.json` | dependency lock | Create (generated) |
| `biome.json` | format + lint config | Create |
| `.prettierrc` | old formatter config | Delete |
| `Dockerfile` | alpine image, multi-stage | Modify |
| `debian.dockerfile` | debian image, multi-stage | Modify |
| `arm32v7.dockerfile`, `arm64v8.dockerfile` | unreferenced legacy | Delete |
| `.dockerignore` | Docker build context | Modify |
| `.github/workflows/ci.yml` | PR/branch gate | Create |
| `.github/workflows/main.yml` | main → GHCR `:main` | Rewrite |
| `.github/workflows/release.yml` | tag → GHCR release tags | Rewrite |
| `.github/workflows/pull_request.yml` | superseded by `ci.yml` | Delete |
| `.github/workflows/pages.yml` | build + deploy Pages | Create |
| `.github/ISSUE_TEMPLATE/` | upstream triage templates | Delete |
| `package.json` | metadata, scripts, deps | Modify |
| `rollup/license.js` | bundle preamble | Modify — add owner copyright |
| `src/index.html` | app shell + meta | Modify |
| `src/components/version-notification.riot` | update check | Modify — repoint API + pull cmd |
| `src/components/error-page.riot` | error help links | Modify — repoint 5 links |
| `src/components/docker-registry-ui.riot` | shell + footer | Modify — repoint 2 footer links |
| `nginx/default.conf` | proxy config | Modify — 2 upstream issue comments |
| `demo/index.html` | Pages live demo | Modify — meta, registry, drop GA + shim |
| `_config.yml` | Jekyll/Pages config | Modify — url, theme, author, drop GA |
| `screenshot.png` | README + og:image | Replace with fresh capture |
| `docker-registry-ui.gif` | unreferenced 3.6 MB asset | Delete |
| `README.md` | primary docs | Rewrite |
| `CONTRIBUTING.md` | contribution notes | Rewrite (short) |
| `CODE_OF_CONDUCT.md`, `CONTRIBUTORS.md` | upstream community docs | Delete |
| `CLAUDE.md` | agent onboarding | Create |
| `UI-UX-REVAMP.md` → `docs/UI-UX-REVAMP.md` | redesign notes | Move |
| `examples/issue-{20,73,75,88,116}`, `examples/pr-219`, `examples/helm` | upstream-specific | Delete |
| `examples/**` (kept) | deployment recipes | Modify — image refs |

---

### Task 1: Untrack `dist/`, commit the lockfile

**Files:**
- Modify: `.gitignore`
- Delete: `.gitattributes`
- Create: `package-lock.json` (generated, committed)
- Untrack: `dist/**`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `npm ci` works and `dist/` is build output only. Tasks 3 and 4 depend on `package-lock.json` existing, because `npm ci` fails without it.

**Context:** `.gitattributes` currently carries a comment block ending in "Do not untrack it", justified by GitHub Pages serving the repo as-is. Task 4 replaces that with a Pages workflow that builds `dist/` at deploy time, which is what makes this safe. `.gitattributes` has no other content, so it is deleted rather than edited.

- [ ] **Step 1: Confirm the current state, so you can tell later whether you broke something**

```bash
git ls-files dist | wc -l          # expect: 20-ish tracked files
ls dist/docker-registry-ui.js      # expect: exists
npm test                           # expect: all suites pass
```

- [ ] **Step 2: Generate the lockfile**

`package-lock.json` is currently gitignored, so it may or may not exist on disk. Regenerate it so it matches `package.json` exactly:

```bash
rm -f package-lock.json
npm install --package-lock-only
```

Expected: `package-lock.json` created, `"lockfileVersion": 3`.

- [ ] **Step 3: Update `.gitignore`**

Remove the `package-lock.json` line and add `dist`. The file becomes:

```gitignore
.project
node_modules
registry-data
.idea
_site
*.orig
.serve/
demo/v2
.version.json
dist
```

- [ ] **Step 4: Delete `.gitattributes`**

```bash
git rm .gitattributes
```

Its entire content is the `dist/** linguist-generated=true -diff -merge` stanza and the comment explaining why `dist/` was committed. Both are obsolete.

- [ ] **Step 5: Untrack `dist/` without deleting it from disk**

```bash
git rm -r --cached dist
```

Use `--cached`. A plain `git rm -r dist` would delete your local build, which you still want for the Docker check in Task 3.

- [ ] **Step 6: Verify `npm ci` works from the new lockfile**

```bash
npm ci && npm test
```

Expected: install completes, all mocha suites pass.

- [ ] **Step 7: Verify `dist/` is untracked but `git status` is clean of it**

```bash
git status --short | grep -c '^?? dist' ; git ls-files dist | wc -l
```

Expected: `git ls-files dist` returns `0`. `dist` may appear as ignored, not untracked — `git status --short` should not list it at all.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package-lock.json
git add -u
git commit -m "chore: untrack dist/ and commit package-lock.json

dist/ is build output. Task 4 adds a Pages workflow that builds it at
deploy time, removing the reason it was committed. The .gitattributes
stanza that pinned it in place goes with it.

Committing the lockfile lets CI use npm ci for reproducible installs."
```

---

### Task 2: Replace Prettier with Biome

**Files:**
- Create: `biome.json`
- Delete: `.prettierrc`
- Modify: `package.json` (scripts, devDependencies)

**Interfaces:**
- Consumes: `package-lock.json` from Task 1.
- Produces: `npm run lint` (runs `biome check .`) and `npm run format` (runs `biome format --write .`). Task 4's `ci.yml` calls `npx biome ci .`.

**Context:** Prettier today formats only `*.html` and `*.js` under `src/`, `rollup/`, and `rollup.config.js` — `.riot` files were always excluded because Prettier's HTML parser mangles Riot single-file components. Biome cannot parse `.riot` either, and its HTML support is not production-ready, so the covered surface becomes JS + JSON. `src/index.html` loses formatting; that is accepted in the spec.

- [ ] **Step 1: Install Biome, remove Prettier**

```bash
npm uninstall prettier
npm install --save-dev --save-exact @biomejs/biome@2.5.7
```

- [ ] **Step 2: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": [
      "**/*.js",
      "**/*.json",
      "!**/*.riot",
      "!src/index.html",
      "!demo/**",
      "!dist/**",
      "!.serve/**",
      "!node_modules/**",
      "!package-lock.json",
      "!examples/electron/**"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "quoteProperties": "preserve"
    }
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  }
}
```

- [ ] **Step 3: Delete the Prettier config**

```bash
git rm .prettierrc
```

- [ ] **Step 4: Replace the format scripts in `package.json`**

Replace these three lines:

```json
    "format": "npm run format-html && npm run format-js",
    "format-html": "find src rollup rollup.config.js -name '*.html' -exec prettier --config .prettierrc -w --parser html {} \\;",
    "format-js": "find src rollup rollup.config.js -name '*.js' -exec prettier --config .prettierrc -w {} \\;",
```

with:

```json
    "format": "biome format --write .",
    "lint": "biome check .",
```

- [ ] **Step 5: Run the formatter and see what it wants to change**

```bash
npx biome check . 2>&1 | tail -30
```

Expected: some diagnostics. Read them. If the linter flags pre-existing application code (not formatting), **do not fix the code** — this task is a tooling swap, not a refactor. Instead, disable that specific rule in `biome.json` under `linter.rules` with a one-line comment saying it is pre-existing, e.g.:

```json
    "rules": {
      "recommended": true,
      "suspicious": { "noAssignInExpressions": "off" }
    }
```

- [ ] **Step 6: Apply formatting**

```bash
npm run format
```

- [ ] **Step 7: Verify the gate is green and tests still pass**

```bash
npx biome ci . && npm test
```

Expected: `biome ci` exits 0, all mocha suites pass.

- [ ] **Step 8: Verify no `.riot` file was touched**

```bash
git diff --name-only | grep '\.riot$' | wc -l
```

Expected: `0`. If Biome reformatted a `.riot` file, the `includes` exclusion is wrong — fix it and revert those files with `git checkout -- 'src/**/*.riot'`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: replace Prettier with Biome

Biome 2.5.7 covers JS and JSON. .riot files stay excluded, as they were
under Prettier — neither tool can parse Riot single-file components.
src/index.html drops out of formatting.

Adds npm run lint for CI to call."
```

---

### Task 3: Multi-stage Docker builds

**Files:**
- Modify: `Dockerfile`, `debian.dockerfile`, `.dockerignore`
- Delete: `arm32v7.dockerfile`, `arm64v8.dockerfile`

**Interfaces:**
- Consumes: `package-lock.json` from Task 1 (the build stage runs `npm ci`).
- Produces: images buildable from a clean checkout with no committed `dist/`. Task 4's workflows build these two files.

**Context:** Both Dockerfiles currently `COPY dist/ /usr/share/nginx/html/`. With `dist/` untracked, that breaks on a clean checkout. `arm32v7.dockerfile` and `arm64v8.dockerfile` are referenced by no workflow, example, or doc — buildx handles multi-arch from the single `Dockerfile`.

- [ ] **Step 1: Confirm the arm dockerfiles really are unreferenced before deleting them**

```bash
grep -rn "arm32v7\|arm64v8" --exclude-dir=.git --exclude-dir=node_modules . | grep -v '^\./docs/'
```

Expected: no hits outside `docs/`. If something does reference them, stop and report it rather than deleting.

- [ ] **Step 2: Delete them**

```bash
git rm arm32v7.dockerfile arm64v8.dockerfile
```

- [ ] **Step 3: Rewrite `.dockerignore`**

The build context now needs the sources, not the bundle:

```
*
!src
!rollup
!rollup.config.js
!package.json
!package-lock.json
!bin
!nginx
!favicon.ico
```

Note `dist` is no longer allowlisted, and the stale `!gulpfile.js` line (no such file exists) is gone.

- [ ] **Step 4: Convert `Dockerfile` to multi-stage**

Keep the existing AGPL comment header at the top **exactly as it is**. Below it, the body becomes:

```dockerfile
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY rollup.config.js ./
COPY rollup/ ./rollup/
COPY src/ ./src/
RUN npm run build

FROM nginx:alpine-slim

LABEL maintainer="Jorge Barnaby (yorch)"
LABEL org.opencontainers.image.title="Docker Registry UI"
LABEL org.opencontainers.image.description="A web UI for private docker registry"
LABEL org.opencontainers.image.source="https://github.com/yorch/docker-registry-ui"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

WORKDIR /usr/share/nginx/html/

ENV NGINX_PROXY_HEADER_Host '$http_host'
ENV NGINX_LISTEN_PORT '80'

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY bin/90-docker-registry-ui.sh /docker-entrypoint.d/90-docker-registry-ui.sh
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY favicon.ico /usr/share/nginx/html/

RUN chown -R nginx:nginx /etc/nginx/ /usr/share/nginx/html/ /var/cache/nginx /var/log/nginx
```

- [ ] **Step 5: Convert `debian.dockerfile` the same way**

Identical `build` stage. The runtime stage keeps its own differences — `FROM nginx:latest` and the extra `ENV SHOW_CATALOG_NB_TAGS 'false'`:

```dockerfile
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY rollup.config.js ./
COPY rollup/ ./rollup/
COPY src/ ./src/
RUN npm run build

FROM nginx:latest

LABEL maintainer="Jorge Barnaby (yorch)"
LABEL org.opencontainers.image.title="Docker Registry UI"
LABEL org.opencontainers.image.description="A web UI for private docker registry"
LABEL org.opencontainers.image.source="https://github.com/yorch/docker-registry-ui"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

WORKDIR /usr/share/nginx/html/

ENV NGINX_PROXY_HEADER_Host '$http_host'
ENV NGINX_LISTEN_PORT '80'
ENV SHOW_CATALOG_NB_TAGS 'false'

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY bin/90-docker-registry-ui.sh /docker-entrypoint.d/90-docker-registry-ui.sh
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY favicon.ico /usr/share/nginx/html/

RUN chown -R nginx:nginx /etc/nginx/ /usr/share/nginx/html/ /var/cache/nginx /var/log/nginx
```

Preserve its existing AGPL comment header verbatim.

- [ ] **Step 6: Build the alpine image**

```bash
docker build -f Dockerfile -t drui:test .
```

Expected: succeeds. If it fails on a missing file, the `.dockerignore` allowlist is missing something the Rollup build reads.

- [ ] **Step 7: Verify the placeholders survived the build — this is the critical check**

```bash
docker run --rm drui:test grep -c 'REGISTRY_URL' /usr/share/nginx/html/index.html
```

Expected: at least `1`. The served `index.html` must still contain the literal string `${REGISTRY_URL}`. If this returns `0`, the build pre-substituted or stripped placeholders and `bin/90-docker-registry-ui.sh` will have nothing to replace at container start.

- [ ] **Step 8: Verify the container actually serves a substituted page**

```bash
docker run -d --rm --name drui-test -p 18080:80 \
  -e REGISTRY_URL=http://example.invalid \
  -e SINGLE_REGISTRY=true \
  drui:test
sleep 3
curl -s localhost:18080/ | grep -o 'registry-url="[^"]*"'
docker stop drui-test
```

Expected: prints `registry-url="http://example.invalid"` — proving the entrypoint substituted the placeholder.

- [ ] **Step 9: Build the debian image**

```bash
docker build -f debian.dockerfile -t drui:test-debian .
```

Expected: succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "build: multi-stage Docker builds, drop unused arm dockerfiles

The bundle is now built inside the image instead of being copied from a
committed dist/. Adds OCI labels and sets maintainer to this fork.

arm32v7.dockerfile and arm64v8.dockerfile were referenced by no workflow,
example, or doc — buildx covers multi-arch from the single Dockerfile."
```

---

### Task 4: Publish to GHCR, modernize workflows, build Pages from Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- Rewrite: `.github/workflows/main.yml`, `.github/workflows/release.yml`
- Delete: `.github/workflows/pull_request.yml`, `.github/ISSUE_TEMPLATE/`

**Interfaces:**
- Consumes: `package-lock.json` (Task 1), `npm run lint` (Task 2), the multi-stage `Dockerfile` / `debian.dockerfile` (Task 3).
- Produces: images at `ghcr.io/yorch/docker-registry-ui`. The README in Task 8 documents these tags.

**Context:** All three existing workflows push to Docker Hub `joxit/docker-registry-ui` with secrets this repo does not have. `release.yml` additionally uses `::set-output`, which GitHub removed in 2023, and downloads `kokai` — upstream's personal release-note tool. GHCR needs no manually-created secrets: the built-in `GITHUB_TOKEN` authenticates given `packages: write`.

- [ ] **Step 1: Delete the superseded workflow and issue templates**

```bash
git rm .github/workflows/pull_request.yml
git rm -r .github/ISSUE_TEMPLATE
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches-ignore: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx biome ci .
      - run: npm test
      - run: npm run build
        env:
          DEVELOPMENT_BUILD: ${{ github.sha }}
```

- [ ] **Step 3: Rewrite `.github/workflows/main.yml`**

```yaml
name: Build and push main images

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx biome ci .
      - run: npm test

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push alpine
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ghcr.io/yorch/docker-registry-ui:main
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push debian
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./debian.dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ghcr.io/yorch/docker-registry-ui:main-debian
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Rewrite `.github/workflows/release.yml`**

Note the `$GITHUB_OUTPUT` form replacing the removed `::set-output`, and `softprops/action-gh-release` replacing the archived `actions/create-release@v1` plus upstream's `kokai`.

```yaml
name: Release

on:
  push:
    tags: ['*']

permissions:
  contents: write
  packages: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx biome ci .
      - run: npm test

      - name: Compute version tags
        id: tags
        run: |
          FULL="${GITHUB_REF_NAME}"
          echo "patch=$(echo "$FULL" | grep -o '^[0-9]*\.[0-9]*\.[0-9]*')" >> "$GITHUB_OUTPUT"
          echo "minor=$(echo "$FULL" | grep -o '^[0-9]*\.[0-9]*')" >> "$GITHUB_OUTPUT"
          echo "major=$(echo "$FULL" | grep -o '^[0-9]*')" >> "$GITHUB_OUTPUT"

      - name: Create GitHub release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push alpine
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/yorch/docker-registry-ui:latest
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.major }}
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.minor }}
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.patch }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push debian
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./debian.dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/yorch/docker-registry-ui:debian
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.major }}-debian
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.minor }}-debian
            ghcr.io/yorch/docker-registry-ui:${{ steps.tags.outputs.patch }}-debian
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 5: Create `.github/workflows/pages.yml`**

This is what makes Task 1's untracking of `dist/` safe — the demo's bundle is built at deploy time.

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build

      - uses: actions/configure-pages@v5
      - uses: actions/jekyll-build-pages@v1
        with:
          source: ./
          destination: ./_site

      - name: Add built bundle and demo to the site
        run: |
          mkdir -p _site/dist _site/demo
          cp -r dist/. _site/dist/
          cp -r demo/. _site/demo/

      - uses: actions/upload-pages-artifact@v3

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: Validate every workflow parses as YAML**

```bash
for f in .github/workflows/*.yml; do
  python3 -c "import yaml,sys; yaml.safe_load(open('$f')); print('ok $f')"
done
```

Expected: `ok` for `ci.yml`, `main.yml`, `pages.yml`, `release.yml`.

- [ ] **Step 7: Verify no workflow still references upstream or Docker Hub**

```bash
grep -rn "joxit\|DOCKERHUB\|set-output\|kokai" .github/workflows/ | wc -l
```

Expected: `0`.

- [ ] **Step 8: Verify no dropped platform crept back in**

```bash
grep -rn "386\|ppc64le\|s390x\|arm/v6\|arm/v7" .github/workflows/ | wc -l
```

Expected: `0`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "ci: publish to GHCR, modernize workflows, build Pages from Actions

Images now go to ghcr.io/yorch/docker-registry-ui using the built-in
GITHUB_TOKEN — no manually-created secrets.

release.yml used ::set-output, removed by GitHub in 2023, so releases
were dead regardless of credentials. Replaced with \$GITHUB_OUTPUT, and
kokai + the archived actions/create-release with action-gh-release.

pages.yml builds dist/ at deploy time, which is what lets dist/ stay
untracked while the live demo keeps working.

Platforms narrowed to linux/amd64 and linux/arm64."
```

**Post-merge manual step for the repo owner, not part of this commit:** set **Settings → Pages → Source = GitHub Actions**, otherwise `pages.yml` fails at the deploy job.

---

### Task 5: Repoint project metadata and copyright

**Files:**
- Modify: `package.json`, `rollup/license.js`, `src/index.html`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `version` = `2.7.0`, which Task 4's release workflow turns into the `:2`, `:2.7`, `:2.7.0` image tags, and which `rollup.config.js:18` reads to write `dist/version.json`.

**Context:** `rollup.config.js` reads `package.json`'s `version` at build time and writes `.version.json` → `dist/version.json`. The app displays it in the footer and `version-notification.riot` compares against it. Bumping the version here is what makes the app report `2.7.0`.

- [ ] **Step 1: Update `package.json` metadata**

Change `version`, `repository.url`, and `author`; add `engines`. Leave `license`, `type`, `description`, and all dependency blocks untouched:

```json
  "version": "2.7.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/yorch/docker-registry-ui.git"
  },
  "author": "Jorge Barnaby (yorch)",
  "license": "AGPL-3.0",
  "description": "A web UI for private docker registry",
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 2: Add the fork's copyright to `rollup/license.js`**

This file exports a template literal used as the minified bundle's preamble. Make a **single-line insertion** — do not retype the file, and do not touch the template-literal delimiters or the AGPL body.

Insert this one line directly after the existing `* Copyright (C) 2016-2023 Jones Magloire @Joxit` line:

```
 * Copyright (C) 2026 Jorge Barnaby @yorch
```

After the edit, lines 1-4 of the file read:

```
export default `/*
 * Copyright (C) 2016-2023 Jones Magloire @Joxit
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
```

Everything from ` * This program is free software:` through the closing `*/` + backtick + semicolon stays byte-identical.

- [ ] **Step 3: Add the fork's copyright to `src/index.html`**

In the HTML comment at the very top, add one line after the Joxit line:

```html
<!--
 Copyright (C) 2016-2023 Jones Magloire @Joxit
 Copyright (C) 2026 Jorge Barnaby @yorch
```

Leave the remainder of the comment unchanged.

- [ ] **Step 4: Remove the upstream Twitter meta from `src/index.html`**

Delete these two lines:

```html
    <meta name="twitter:site" content="@Joxit" />
    <meta name="twitter:creator" content="@Jones Magloire" />
```

Keep `<meta name="twitter:card" content="summary" />` and `<meta property="og:site_name" content="Docker Registry UI" />` — the product name is unchanged.

- [ ] **Step 5: Verify the version propagates into the build**

```bash
npm run build && cat dist/version.json
```

Expected: `{"version":"2.7.0","latest":"2.7.0"}`.

- [ ] **Step 6: Verify the bundle preamble carries both copyright lines**

```bash
head -5 dist/docker-registry-ui.js
```

Expected: both `Jones Magloire @Joxit` and `Jorge Barnaby @yorch` lines present.

- [ ] **Step 7: Verify tests and lint still pass**

```bash
npm test && npx biome ci .
```

Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add package.json rollup/license.js src/index.html
git commit -m "chore: repoint project metadata and copyright to this fork

Bumps to 2.7.0, points repository and author at this fork, and adds an
engines floor.

Adds this fork's copyright line beneath the original author's in the
bundle preamble and app shell. AGPL-3.0 requires the original notice to
stay; it is added to, never replaced."
```

---

### Task 6: Point in-app links at this fork

**Files:**
- Modify: `src/components/version-notification.riot`, `src/components/error-page.riot`, `src/components/docker-registry-ui.riot`, `nginx/default.conf`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new API. `version-notification.riot`'s poll URL and pull-command string change value only; `isNewestVersion(props.version, state.tag_name)` and the `props.onNotify(message)` callback keep their existing signatures.

**Context:** This is the only task that changes runtime behavior. Today the app polls upstream's releases and, on a newer upstream release, tells the operator to `docker pull joxit/docker-registry-ui:<tag>` — wrong software, wrong registry. The feature is already gated behind `ENABLE_VERSION_NOTIFICATION` and already handles HTTP 404 silently (`version-notification.riot`, the `else if (this.status !== 404)` branch), so it degrades cleanly until this repo has its first release.

- [ ] **Step 1: Repoint the update-check API URL**

In `src/components/version-notification.riot`, change:

```js
        oReq.open('GET', 'https://api.github.com/repos/joxit/docker-registry-ui/releases/latest');
```

to:

```js
        oReq.open('GET', 'https://api.github.com/repos/yorch/docker-registry-ui/releases/latest');
```

- [ ] **Step 2: Repoint the pull command shown in the update dialog**

In the same file, change:

```html
    <code class="pull-command">joxit/docker-registry-ui:{ state.tag_name }</code>
```

to:

```html
    <code class="pull-command">ghcr.io/yorch/docker-registry-ui:{ state.tag_name }</code>
```

- [ ] **Step 3: Repoint the footer links in `src/components/docker-registry-ui.riot`**

Change both `<a>` hrefs in the `app-footer` block:

```html
          <a href="https://github.com/yorch/docker-registry-ui" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://github.com/yorch/docker-registry-ui/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>
```

These two links are what satisfy AGPL §13's network-use source offer. They must point at a repo that actually serves this code — hence the change.

- [ ] **Step 4: Repoint the `CATALOG_NOT_FOUND` help links in `src/components/error-page.riot`**

Change:

```html
        <a href="https://joxit.dev/docker-registry-ui/#faq">FAQ</a> and
        <a href="https://joxit.dev/docker-registry-ui/#available-options">Available options</a>
```

to point at this repo's README anchors:

```html
        <a href="https://github.com/yorch/docker-registry-ui#faq">FAQ</a> and
        <a href="https://github.com/yorch/docker-registry-ui#available-options">Available options</a>
```

Task 8 must keep `## FAQ` and `## Available options` headings in the README so these anchors resolve.

- [ ] **Step 5: Rewrite the `MIXED_CONTENT` issue reference**

Upstream issue #277 does not exist in this repo. Replace:

```html
      <p>You can check the issue <a href="https://github.com/Joxit/docker-registry-ui/issues/277">#277</a>.</p>
```

with prose that keeps the information and drops the dead link:

```html
      <p>
        See the <a href="https://github.com/yorch/docker-registry-ui#faq">FAQ</a> for more on running the UI
        behind a reverse proxy.
      </p>
```

- [ ] **Step 6: Rewrite the `PAGINATION_NUMBER_INVALID` references**

Replace the sentence citing upstream's milestone and issue:

```html
      <p>
        The new default value for the UI is <code>1000</code> since
        <a href="https://github.com/Joxit/docker-registry-ui/milestone/6">2.5.0</a> and was <code>100000</code> from
        <a href="https://github.com/Joxit/docker-registry-ui/issues/39">0.3.6</a>.
      </p>
```

with the same facts, unlinked:

```html
      <p>The new default value for the UI is <code>1000</code> since 2.5.0, and was <code>100000</code> from 0.3.6.</p>
```

And replace the trailing "More about this issue" paragraph:

```html
      <p>
        More about this issue:
        <a href="https://github.com/Joxit/docker-registry-ui/issues/306">Joxit/docker-registry-ui#306</a>.
      </p>
```

with:

```html
      <p>
        More about this:
        <a href="https://github.com/yorch/docker-registry-ui#faq">FAQ</a>.
      </p>
```

Leave the link to `distribution/distribution` releases alone — that is the upstream *registry server*, not this project's upstream fork parent, and it is a correct reference.

- [ ] **Step 7: Update the two upstream issue comments in `nginx/default.conf`**

These are comments, not links users click, but they cite issue numbers that do not exist here. Change:

```
    # required for strict SNI checking: see Issue #70 (https://github.com/Joxit/docker-registry-ui/issues/70)
```

to:

```
    # required for strict SNI checking (originally Joxit/docker-registry-ui#70)
```

and:

```
    # Fix push and pull of large images: see Issue #282 (https://github.com/Joxit/docker-registry-ui/issues/282)
```

to:

```
    # Fix push and pull of large images (originally Joxit/docker-registry-ui#282)
```

- [ ] **Step 8: Verify no upstream URL remains in `src/` or `nginx/`**

```bash
grep -rn "joxit.dev\|github.com/Joxit\|api.github.com/repos/joxit" src/ nginx/
```

Expected: no output. Copyright lines mentioning `@Joxit` remain and are correct — this grep deliberately does not match them.

- [ ] **Step 9: Verify the build still succeeds and tests pass**

```bash
npm run build && npm test && npx biome ci .
```

Expected: all green.

- [ ] **Step 10: Verify the new pull command is actually in the bundle**

```bash
grep -c 'ghcr.io/yorch/docker-registry-ui' dist/docker-registry-ui.js
```

Expected: at least `1`.

- [ ] **Step 11: Commit**

```bash
git add src/components/version-notification.riot src/components/error-page.riot src/components/docker-registry-ui.riot nginx/default.conf
git commit -m "fix: point version notification and in-app links at this fork

The update check polled upstream's releases and told operators to pull
joxit/docker-registry-ui — wrong software, wrong registry. It now polls
this repo and shows the GHCR image.

Error-page help links and the footer source link follow. The footer link
is what satisfies AGPL section 13's network-use source offer, so it has
to point at a repo that actually serves this code."
```

---

### Task 7: Prune upstream-specific files

**Files:**
- Delete: `CODE_OF_CONDUCT.md`, `CONTRIBUTORS.md`, `docker-registry-ui.gif`, `examples/issue-20`, `examples/issue-73`, `examples/issue-75`, `examples/issue-88`, `examples/issue-116`, `examples/pr-219`, `examples/helm`
- Modify: every kept `examples/**` file referencing `joxit/docker-registry-ui`

**Interfaces:**
- Consumes: the image name established in Task 4.
- Produces: an `examples/` tree whose compose files pull `ghcr.io/yorch/docker-registry-ui`. Task 8's README links to these directories, so the kept set is fixed here.

**Context:** Six example directories are named after upstream issue and PR numbers and only make sense against upstream's tracker. `examples/helm/` is a single README stating the chart moved to `helm.joxit.dev` — a pointer to upstream's chart, packaging upstream's image, with no chart of its own. `docker-registry-ui.gif` is 3.6 MB and referenced by nothing in this repo (the README hot-links upstream's hosted copy instead).

- [ ] **Step 1: Confirm the gif is genuinely unreferenced before deleting 3.6 MB**

```bash
grep -rn "docker-registry-ui.gif" --exclude-dir=.git --exclude-dir=node_modules . | grep -v '^\./docs/'
```

Expected: at most a hit in `README.md` pointing at `raw.github.com/Joxit/...` — that is upstream's hosted copy, not this file. If something references the local path, stop and report.

- [ ] **Step 2: Delete the upstream-specific files**

```bash
git rm CODE_OF_CONDUCT.md CONTRIBUTORS.md docker-registry-ui.gif
git rm -r examples/issue-20 examples/issue-73 examples/issue-75 examples/issue-88 examples/issue-116 examples/pr-219 examples/helm
```

- [ ] **Step 3: Repoint deployment image references in the kept examples**

```bash
grep -rl 'joxit/docker-registry-ui' examples/ | xargs perl -pi \
  -e 's|docker\.io/joxit/docker-registry-ui|ghcr.io/yorch/docker-registry-ui|g;' \
  -e 's|joxit/docker-registry-ui|ghcr.io/yorch/docker-registry-ui|g;'
```

Use `perl -pi`, not `sed -i`. In-place editing differs between BSD `sed` (macOS, needs `-i ''`) and GNU `sed` (Linux, bare `-i`), and BSD `sed` does not support `\b` word boundaries. `perl -pi` behaves identically on both.

The first expression runs before the second so `docker.io/joxit/...` becomes `ghcr.io/yorch/...` rather than `docker.io/ghcr.io/yorch/...`. The second expression is deliberately unanchored, which means it also rewrites the `localhost:5000/joxit/...` paths in the populate scripts — Step 4 corrects those.

- [ ] **Step 4: Fix the double-prefixing this creates in the populate scripts**

`examples/ui-as-proxy/populate.sh` and `examples/ui-as-standalone/populate.sh` retag an image *into* a local registry, so they contain paths like `localhost:5000/joxit/docker-registry-ui`. Step 3 turns those into `localhost:5000/ghcr.io/yorch/...`, which is wrong. Inspect and correct:

```bash
grep -n 'ghcr.io' examples/ui-as-proxy/populate.sh examples/ui-as-standalone/populate.sh
```

Any line where `ghcr.io/yorch/docker-registry-ui` appears *after* a `localhost` or `localhost:5000` prefix must become plain `yorch/docker-registry-ui` — it is a path inside the throwaway local registry, not a pullable image. For example `localhost:5000/ghcr.io/yorch/docker-registry-ui:static` becomes `localhost:5000/yorch/docker-registry-ui:static`. The leading `docker tag ghcr.io/yorch/docker-registry-ui:static` source reference is correct as-is.

- [ ] **Step 5: Verify no example still pulls the upstream image**

```bash
grep -rn 'joxit/docker-registry-ui' examples/ | wc -l
```

Expected: `0`.

- [ ] **Step 6: Verify no double-prefixed registry path survived**

```bash
grep -rn 'localhost[^ ]*/ghcr\.io' examples/ | wc -l
```

Expected: `0`.

- [ ] **Step 7: Verify the kept example set matches the spec**

```bash
ls examples/
```

Expected exactly: `README.md`, `electron`, `kubernetes`, `populate-registry`, `proxy-headers`, `read-only-auth`, `token-auth-keycloak`, `traefik`, `ui-as-proxy`, `ui-as-standalone`.

- [ ] **Step 8: Update `examples/README.md` if it indexes deleted directories**

```bash
grep -n 'issue-\|pr-219\|helm' examples/README.md
```

Remove any line referencing a directory deleted in Step 2. If there are no hits, skip.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: prune upstream-specific files and examples

Removes six example directories named after upstream issue and PR
numbers, and examples/helm — a stub README pointing at upstream's chart
repo, which packages upstream's image and has no chart of its own.

Also drops the 3.6 MB gif (referenced by nothing here; the README
hot-linked upstream's hosted copy) and the upstream community docs.

Remaining examples pull ghcr.io/yorch/docker-registry-ui."
```

---

### Task 8: Rewrite docs, Pages config, and the demo

**Files:**
- Rewrite: `README.md`, `CONTRIBUTING.md`, `_config.yml`, `demo/index.html`
- Replace: `screenshot.png`
- Create: `CLAUDE.md`
- Move: `UI-UX-REVAMP.md` → `docs/UI-UX-REVAMP.md`

**Interfaces:**
- Consumes: the image name and tag scheme from Task 4; the kept `examples/` set from Task 7; the README anchors `#faq` and `#available-options` that Task 6's error page links to.
- Produces: the final documentation surface. Nothing depends on it.

**Context:** `demo/index.html` contains two separate upstream tracking mechanisms: `_config.yml`'s `google_analytics` key *and* an inline `ga('create', 'G-T158HYBVZ2', 'auto')` script block. Removing only the first leaves the second reporting to upstream's Analytics property.

- [ ] **Step 1: Move the redesign notes**

```bash
git mv UI-UX-REVAMP.md docs/UI-UX-REVAMP.md
```

- [ ] **Step 2: Rewrite `_config.yml`**

```yaml
title: Docker Registry User Interface
description: The simplest and most complete UI for your private registry!
url: https://yorch.github.io/docker-registry-ui
theme: jekyll-theme-cayman
author: Jorge Barnaby
defaults:
  - scope:
      path: ''
    values:
      image: /screenshot.png
plugins:
  - jekyll-seo-tag
exclude:
  - node_modules
  - package.json
  - package-lock.json
  - biome.json
  - rollup.config.js
  - rollup
  - src
  - test
  - bin
  - nginx
  - examples
  - docs
  - Dockerfile
  - debian.dockerfile
  - .dockerignore
  - CLAUDE.md
  - CONTRIBUTING.md
```

Gone: `google_analytics: G-T158HYBVZ2` (upstream's Analytics property), `remote_theme: joxit/joxit.github.io` (a theme built from upstream's repo, which upstream could change or delete), and the `twitter` / `instagram` blocks.

`theme:` replaces `remote_theme:` because `actions/jekyll-build-pages` supports the bundled GitHub Pages themes directly.

**The `exclude:` list is not cosmetic.** `pages.yml` runs `npm ci` before the Jekyll step, so `node_modules/` exists in the working directory when Jekyll runs. Jekyll copies everything it is not told to exclude into `_site/`, which would balloon the Pages artifact with thousands of dependency files. Upstream's `_config.yml` had no `exclude:` because its Pages build ran on GitHub's branch-based pipeline, where `node_modules` never existed.

- [ ] **Step 3: Rewrite `demo/index.html`**

Keep the AGPL comment header, adding the fork's copyright line beneath Joxit's exactly as in Task 5. Then:

Replace the two `content="...Sources : https://github.com/Joxit/docker-registry-ui"` description strings with `https://github.com/yorch/docker-registry-ui`.

Replace the canonical and og:url:

```html
    <link rel="canonical" href="https://yorch.github.io/docker-registry-ui/demo/" />
    <meta property="og:url" content="https://yorch.github.io/docker-registry-ui/demo/" />
```

Delete these two lines:

```html
    <meta name="twitter:site" content="@Joxit" />
    <meta name="twitter:creator" content="@Jones Magloire" />
```

In the `<docker-registry-ui>` element, empty the default registry so the demo no longer points at a registry upstream hosts:

```html
      default-registries=""
```

Delete the entire `<script>` block that rewrites `localStorage.registryServer` from `https://raw.githubusercontent.com/Joxit/docker-registry-ui/master/demo` — it is a migration shim for upstream's old demo URL.

Delete the entire trailing `<script>` block containing the Google Analytics snippet (the IIFE ending in `ga('create', 'G-T158HYBVZ2', 'auto'); ga('send', 'pageview');`).

Keep `<script src="../dist/docker-registry-ui.js"></script>` and the `../dist/docker-registry-ui.css` stylesheet link — Task 4's `pages.yml` copies a freshly built `dist/` next to `demo/` so these relative paths resolve.

- [ ] **Step 4: Verify the demo has no upstream references or trackers left**

```bash
grep -n 'joxit\|Joxit\|G-T158HYBVZ2\|google-analytics' demo/index.html
```

Expected: exactly one hit — the `Copyright (C) 2016-2023 Jones Magloire @Joxit` line. Anything else is a defect.

- [ ] **Step 5: Capture a fresh screenshot**

The committed `screenshot.png` shows upstream's pre-redesign UI. Start the app against a populated local registry:

```bash
cd examples/ui-as-standalone && docker compose -f simple.yml up -d && cd ../..
```

Wait for it to come up, populate it if the compose file does not seed data (`examples/ui-as-standalone/populate.sh`), then open the UI in a browser, capture the catalog view, and save it over `screenshot.png` at the repo root. Tear down with `docker compose -f examples/ui-as-standalone/simple.yml down`.

Expected: `screenshot.png` shows the current sidebar-shell design, not upstream's old Material UI.

If the app cannot be brought up in this environment, **stop and report it** rather than committing a stale or placeholder image — `_config.yml` and the README both point at this file.

- [ ] **Step 6: Rewrite `README.md`**

Structure, in order:

1. `# Docker Registry User Interface`
2. Badges: this repo's release and stars, plus a GHCR package badge. Remove upstream's Docker Hub pulls badge, the `joxit.dev` sponsor badge, and the Artifact Hub badge.
3. **A fork notice immediately below the badges:**

   > This is a fork of [Joxit/docker-registry-ui](https://github.com/Joxit/docker-registry-ui), maintained independently for my own use. It is not affiliated with or endorsed by the original author. Licensed AGPL-3.0, same as upstream.

4. `## Changes from upstream` — enumerate: the SaaS redesign (sidebar shell, data tables, light/dark themes) with riot-mui removed and a dependency-free design system in its place; async tag counts in the catalog; images published to GHCR instead of Docker Hub; Biome instead of Prettier; multi-stage Docker builds with `dist/` no longer committed; build platforms narrowed to amd64/arm64. **This section is what satisfies AGPL §5(a)'s requirement that modified versions carry prominent notices stating the modification.** Do not drop it.
5. `## Overview` — carried over, with the riot-mui sentence already updated by the redesign commit.
6. `![preview](./screenshot.png "Preview of Docker Registry UI")` — the local file from Step 5, replacing the hot-linked upstream gif.
7. `## Supported Docker tags` — rewrite for GHCR. `latest`, `latest-debian`, `main`, `main-debian`, `2`, `2.x`, `2.x.y` and their `-debian` variants. Remove the `master` / `master-debian` aliases; the new workflows do not produce them.
8. Every `docker pull` / compose / kubernetes snippet → `ghcr.io/yorch/docker-registry-ui`.
9. `## Available options` — **carry the env-var reference table over essentially verbatim.** It is the most load-bearing content in the file and must not be re-derived from memory. The heading text must stay exactly `## Available options` so Task 6's `#available-options` anchor resolves.
10. `## FAQ` — carried over. Heading must stay exactly `## FAQ` so the `#faq` anchor resolves.
11. Links to upstream's wiki (e.g. the 1.x → 2.x migration guide) are kept where no local equivalent exists, each clearly marked as upstream documentation.

- [ ] **Step 7: Verify the anchors Task 6 depends on actually exist**

```bash
grep -n '^## FAQ$\|^## Available options$' README.md
```

Expected: two hits. If either heading was renamed, Task 6's error-page links break.

Also confirm the Pages landing page still resolves. `index.md` is a **symlink** to `README.md` — that symlink is what Jekyll renders as the site's home page, so it must survive the rewrite:

```bash
ls -l index.md && head -1 index.md
```

Expected: `index.md -> README.md`, and the first line is `# Docker Registry User Interface`. If the rewrite replaced the symlink with a regular file, restore it: `rm index.md && ln -s README.md index.md`.

- [ ] **Step 8: Verify no README snippet still pulls the upstream image**

```bash
grep -n 'joxit/docker-registry-ui\|hub.docker.com' README.md
```

Expected: only occurrences inside the fork notice and the upstream-wiki links — never inside a `docker pull`, `image:`, or compose snippet.

- [ ] **Step 9: Rewrite `CONTRIBUTING.md`**

Short, honest, and accurate about what this repo is:

```markdown
# Contributing

This is a personal fork of [Joxit/docker-registry-ui](https://github.com/Joxit/docker-registry-ui),
maintained for my own use. Issues and pull requests are welcome, but there is no
guaranteed response time and no roadmap.

If your change would benefit everyone, consider sending it to
[upstream](https://github.com/Joxit/docker-registry-ui) instead — it has a far
larger user base.

## Development

See [CLAUDE.md](./CLAUDE.md) for build, test, and formatting commands.
```

- [ ] **Step 10: Create `CLAUDE.md`**

```markdown
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
```

- [ ] **Step 11: Verify the whole tree is clean of non-attribution upstream references**

```bash
grep -rin "joxit" --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  --exclude=LICENSE --exclude-dir=docs .
```

Review every hit by hand. Each one must be exactly one of:
- a `Copyright (C) 2016-2023 Jones Magloire @Joxit` line
- the README fork notice or `## Changes from upstream` section
- a `CONTRIBUTING.md` reference to upstream
- an `(originally Joxit/docker-registry-ui#NN)` comment in `nginx/default.conf`
- a clearly-marked link to upstream's wiki in the README

Anything else is a defect. There must be **zero** hits for `joxit.dev`, `helm.joxit.dev`, `G-T158HYBVZ2`, or `hub.docker.com/r/joxit`.

- [ ] **Step 12: Verify the full gate passes**

```bash
npm ci && npm test && npx biome ci . && npm run build
```

Expected: all green, `dist/index.html` still contains `${REGISTRY_URL}`.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "docs: rewrite README, Pages config, and demo for this fork

README gains a fork notice and a 'Changes from upstream' section, which
is what AGPL section 5(a) requires of a modified version. The options
reference and FAQ are carried over intact — the error page links to
their anchors.

_config.yml drops upstream's Google Analytics property and its
remote_theme, which built this site from upstream's repo. demo/index.html
had a *second*, inline copy of the same Analytics snippet; both are gone,
along with the default registry pointing at upstream's hosted demo.

Adds CLAUDE.md documenting the entrypoint templating gotcha."
```

---

## Post-merge manual steps for the repo owner

Not part of any commit:

1. **Settings → Pages → Source = GitHub Actions**, or `pages.yml` fails at the deploy job.
2. After the first release, **Packages → docker-registry-ui → Package settings → Visibility = Public**, or `docker pull` fails for anyone unauthenticated. GHCR packages default to private.
3. Tag `2.7.0` to cut the first release: `git tag 2.7.0 && git push origin 2.7.0`.
