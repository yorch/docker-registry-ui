# Code review, October 2026

An exhaustive review of Registry Explorer at release 3.2.1 (`c4bdb0a`), run as eight
parallel reviewers across eight aspects. This document is the record of what was
found. Findings are **read-only analysis**: reviewers read the code, and the
highest-impact claims were re-checked by hand. Anything a reviewer could not confirm
is marked _unverified_. The test suite and linter were not run by the reviewers (no
`node_modules/` at the time); the baseline on `main` is 187 passing tests, lint clean.

## Status key

- **Fixed**: the critical/high pass (#25) and the follow-up pass over the medium and
  low items (#26 to #31). The section "Status after the follow-up pass" at the end lists
  exactly what is done, so the per-item lists below are the original findings and some
  of them are now fixed.
- **Open**: not yet addressed. Tracked here so it is not lost.

## How the findings are grouped

| Tier | Meaning |
|---|---|
| Critical / High | Data loss, credential exposure, a broken release, or the UI showing the wrong thing |
| Medium | Real defects with a narrower trigger, accessibility failures, drift |
| Low | Hygiene, polish, documentation accuracy |

---

## Critical / High

| # | Finding | Where | Status |
|---|---|---|---|
| H1 | **Bearer-token theft.** With `REGISTRY_URL` unset (the default), the registry comes from `?url=`. Any 401 with `WWW-Authenticate: Bearer realm=...` makes the UI GET the realm with credentials, then replays the request with the minted token to the attacker's registry. The realm origin is never checked. The token query string is also not URL-encoded. | `docker-registry-ui.riot` `onAuthentication`; `http.js` | Fixed in this PR |
| H2 | **A failed token fetch wedges the app.** If the token request fails or returns non-JSON, `onAuthenticated` is never called, so the original request never settles and its pool slot is never released. Six failures starve the shared 6-slot pool for the session. | `docker-registry-ui.riot`; `http.js` | Fixed in this PR |
| H3 | **Plain-HTTP hosts hang.** The digest fallback guards on `window.crypto && TextEncoder`, but `crypto.subtle` only exists on secure contexts. On `http://` it throws inside `loadend`, so tag rows stay at "…" and the delete dialog sticks on "Deleting…". | `http.js` `getContentDigest` | Fixed in this PR |
| H4 | **Tag-list delete removes tags the dialog never showed.** The dialog lists siblings from a cached digest, the delete re-reads a fresh digest and removes it with no alias re-check (retention already has this guard). Two aliases of one digest also fire two concurrent DELETEs, so the second reports a false "not found". | `confirm-delete-image.riot` | Fixed in this PR |
| H5 | **`tags/list` pagination is never followed**, which also defeats the retention sibling-tag guard on registries that paginate (_registry behaviour unverified_). | `registry-client.js` `tags`, `currentAliases` | Fixed in this PR |
| H6 | **Retention can delete a tagged child of a kept index**, breaking pulls for that platform. `planRetention` groups by tagged digest and does not know which digests an index references. | `registry-analysis.js` `planRetention` | Fixed in this PR |
| H7 | **A retention plan can be executed against a different registry.** `registry-operations` ignores a changed `registryUrl` and stays mounted after a switch. | `registry-operations.riot` | Fixed in this PR |
| H8 | **Catalog and tag rows show the wrong data.** `each` loops without `key` reuse rows by index, and item-derived state is set only in `onBeforeMount`. After a registry switch, refresh, or load-more, rows show the previous item. | `catalog.riot`, `catalog-element.riot`, `tag-table.riot` | Fixed in this PR |
| H9 | **Resets inside `onUpdated` never render.** Riot skips the DOM patch for an `update()` made while the component is already updating, so a registry switch or navigation never shows the loading state and the old UI (with live delete buttons) stays on screen. | `catalog.riot`, `tag-list.riot`, `search-bar.riot` | Fixed in this PR |
| H10 | **A stale tag selection survives navigation and refresh**, so Delete can remove tags that are no longer shown. | `tag-table.riot` | Fixed in this PR |
| H11 | **Tag-history spinner can hang forever.** The page fills in `onBeforeMount` but subscribes in `onMounted`; cache hits replay synchronously, so the events fire before anyone listens. | `tag-history.riot` | Fixed in this PR |
| H12 | **No publish gate.** `main` has no branch protection. `main.yml` and `release.yml` skip e2e. A prerelease tag such as `3.3.0-rc1` matches the release glob and would overwrite `:latest`, `:3`, `:3.3`. Nothing checks that the tag equals `package.json` version or that the commit is on `main`. | `.github/workflows/` | Workflow parts fixed in this PR; branch protection needs a repo admin |
| H13 | **The destructive delete path is nearly untested.** `executeDelete` has no tests, and the mock registry accepts DELETE by tag (a real registry rejects it), has no 401, 405 or 5xx, and ignores `n`/`last` on `tags/list`. | `test/`, `dev/mock-registry/server.js` | Fixed in this PR |

### What the adversarial pass added

The critical/high fixes were attacked by three Opus reviewers, then the delete and
retention changes by a fourth. They found real holes in the first-pass fixes, which
were fixed in the same PR with tests that were watched failing first:

- **H1 was bypassable.** Trust was judged from the UI's current registry, not the
  request that got the 401. Trust is now decided from the request URL, and a minted
  bearer is never replayed to another origin.
- **H2 still wedged on a throwing callback and on a token server that never
  answers.** Both now settle, and the token request has a 30s timeout.
- **H5 was defeated by the cache.** A cached first `tags/list` page lost its `Link`
  header, so pagination silently stopped. `tags()` is now always fetched fresh,
  rejects cross-origin `Link` targets, and is capped.
- **H6 missed mixed, nested and un-inspectable indexes**, and assumed a candidate
  index would always be deleted. Indexes are now classified by their `manifests`
  array, every descendant is recorded, repositories with a scan error are not
  offered, and children of any index (kept or candidate) are held back.
- **Execution time did not re-check index references.** `currentAliases` now also
  returns every index that references a digest, and both delete paths refuse it.
  Nested indexes are classified by their fetched body, not by a descriptor claim.
- **H8 follow-ups:** multi-arch history showed the wrong architecture after a tab
  switch; refreshed rows stayed bound to the old image object; typing in search
  cleared the selection.

## Known open items found by the adversarial pass (not fixed here)

- **Reproducible-build dates break "keep newest".** Images built with
  `SOURCE_DATE_EPOCH=0` (ko, bazel `rules_oci`, nix) carry a 1970 or `0001-01-01`
  `created`. All dates tie, so ordering falls back to alphabetical tag order, and
  retention can offer the newest releases. Proven at the plan level; how common this
  is in the wild is unverified. Treat a pre-2000 `created` as "unavailable".
- **Cosign `.sig`/`.att`/`.sbom` tags** may read as ancient and become candidates
  (unverified). Protect them by default, or fix the date handling above.
- **Registry behind a path prefix** (`https://host/registry`): the registry's `Link`
  header is root-relative and is now rejected, so the scan and Load More throw. The old
  code followed a wrong URL, so this is not a regression. See M-COR-9.
- **The alias snapshot is taken once per repository** and held for the whole run, so
  the window in which a tag can be pushed before its DELETE grows with the run.
  Re-snapshot every N deletes or T seconds.
- **The dialog's fresh alias check costs one uncached manifest GET per tag.** A
  repository with thousands of tags makes a dialog delete slow.
- **An index referenced only by digest (untagged)** cannot be found through the tag
  list. The referrers API lists `subject` back-links, not parent indexes.
- **Digest-addressed cache entries are not hash-verified** (M-SEC-5), which is why the
  alias checks bypass the cache.

---

## Medium (open)

### Security
- **M-SEC-1** The nginx `/v2` proxy forwards PUT, POST, PATCH and DELETE even when `DELETE_IMAGES=false`; that option only hides buttons. Render `limit_except GET HEAD OPTIONS { deny all; }` when deletes are off. (`nginx/default.conf`, `bin/90-docker-registry-ui.sh`)
- **M-SEC-2** nginx sets no security headers (no `X-Frame-Options`/`frame-ancestors`, CSP, `nosniff`, referrer policy), so the UI can be framed and used for clickjacked deletes.
- **M-SEC-3** Workflow supply chain: publish jobs run `npm ci` (install scripts) with `packages: write`/`contents: write`; `persist-credentials` is not disabled; no action is pinned to a SHA; there is no Dependabot config. `ci.yml` has no `permissions:` block.
- **M-SEC-4** The entrypoint's `sed` substitution corrupts values containing `&`, `~`, `,`, `^` or `\`, and a `"` in a value escapes the HTML attribute or the quoted nginx header value (injection from an env var; operator-controlled, so low risk in most deployments). Escape per delimiter, HTML-escape for `index.html`, reject `"`, `;` and newlines in `NGINX_PROXY_HEADER_*`.
- **M-SEC-5** Digest-addressed cache entries are keyed without the registry and never hash-verified, so one registry can poison another's cached config blob (and the dates retention reads). Verify `sha256(body) === digest` before caching.
- **M-SEC-6** Hardening: `parseNextLink` follows `Link: next` to any origin; `error-page.riot` renders `props.url` as an `href` with no scheme check; `version-notification.riot` renders `html_url` unchecked; the dev mock registry binds all interfaces with `ACAO: *` and DELETE.

### Correctness
- **M-COR-1** The "namespaces" badge uses `tree.length`, which counts bare repositories (`['nginx','redis','team/a']` reads "3 namespaces"). The `nNamespaces === 1` default-expand check is affected too. (`catalog.riot:316,406`)
- **M-COR-2** `getBranching` builds a different tree depending on sort order when `max >= 2`. Build by prefix walk. (`repositories.js`)
- **M-COR-3** An OCI index whose children are Docker v2 manifests (or nested indexes) is treated as a single image, so size is the sum of manifest descriptor bytes and the date is missing. (`docker-image.js`, `registry-client.js`)
- **M-COR-4** `Invalid Date` reaches the UI ("undefined ago") when both `created` and the annotation are missing. (`docker-image.js:219`)
- **M-COR-5** History/layer misalignment throws before the `creation-date` and `blobs` events, so tag history never renders. (`docker-image.js:222`)
- **M-COR-6** `USE_CONTROL_CACHE_HEADER` is bypassed by the 30s sessionStorage cache.
- **M-COR-7** A global `requestPool.drop()` cancels other screens' queued work (a retention scan, or another `<docker-registry-ui>` instance). Drop per owner.
- **M-COR-8** `keepNewest` counts tags, not images, so a stack of aliases on one digest counts as N.
- **M-COR-9** `Link` headers are resolved against the page URL and lose a proxy path prefix.
- **M-COR-10** Registry switch or add does not leave the tag list or tag history; `router.home()` only returns a string. (`registry-menu.riot`, `add-registry-url.riot`)
- **M-COR-11** Tag-list filter does not reset the page on screen (re-entrant `update()` in `onUpdated`). Tag rows keyed by index also leave stale cells (`image-details`, `remove-image`, `architectures`).
- **M-COR-12** The tag list's `window` resize listener is never removed.

### Build and release
- **M-BLD-1** The GitHub release is created before images are pushed.
- **M-BLD-2** Env changes are ignored on `docker restart`, because the entrypoint rewrites `index.html` in place.
- **M-BLD-3** The Docker `build` stage runs under QEMU for arm64; use `FROM --platform=$BUILDPLATFORM`.
- **M-BLD-4** Base images are unpinned (`nginx:latest` in the Debian variant). No `HEALTHCHECK`; no non-root default.
- **M-BLD-5** `debian.dockerfile` sets `SHOW_CATALOG_NB_TAGS=false` while the README documents the default as `true`.

### Accessibility and theming
- **M-A11Y-1** Dark theme white-on-`--danger` is 2.77–3.76:1 (`.btn--danger`, error snackbar). Add a `--danger-bg` token.
- **M-A11Y-2** `--text-muted` fails 4.5:1 in both themes and is used for real text; control borders fail 3:1.
- **M-A11Y-3** 24 decorative `material-icons` elements lack `aria-hidden`, so "send", "folder", "sell" are read aloud inside links.
- **M-A11Y-4** Dialogs have no Escape, focus move, focus trap, or focus return. The registry menu and tabs use ARIA roles without the pattern.
- **M-A11Y-5** `THEME_HEADER_*` and `THEME_FOOTER_*` are documented and written by `theme.js` but no style reads them.
- **M-A11Y-6** No `lang` and no `color-scheme` in the app; auto theme freezes after the first visit (the computed value is persisted and read back before `matchMedia`).
- **M-A11Y-7** The snackbar is not a reliable live region and errors auto-dismiss in 4s with no pause.

### Tests
- **M-TST-1** `confirm-delete-image` failure branches (404, 405, missing digest header, CORS), `RegistryClient.deleteManifest`, `http.js` 401/network error paths, `allRepositories` cancel and mid-traversal failure all lack tests.
- **M-TST-2** The e2e "refresh bypasses cache" test would pass even if the cache were served. e2e shares one mock store, so the delete test mutates `nginx` for later tests.
- **M-TST-3** `product-name.test.js` has no positive control and depends on `git ls-files`.
- **M-TST-4** e2e runs on pull requests only, never on push to `main` or before release.

### Licensing and docs
- **M-LIC-1** The upstream Joxit copyright header was stripped from five Riot files by the redesign commit `e74bc2a` (`dockerfile`, `copy-to-clipboard`, `pagination`, `remove-image`, `tag-history-button`). About 40 other files carry no header at all, so CLAUDE.md's "every source file carries" is not literally true.
- **M-DOC-1** README FAQ says only basic auth is supported; Bearer token auth works.
- **M-DOC-2** CLAUDE.md still lists the removed `DOCKER_REGISTRY_UI_TITLE`; the site quick start shows `2.x` tags; the README options list has a stray sentence mid-list; `Developing.md` omits the `single-platform-index` fixture; "images" is used where the project's vocabulary says "repositories" (error page, README).

## Low (open)

- Dead code: `src/roboto.scss` (never imported), about 55 lines of unused `.switch` CSS, exports never imported (`MANIFEST_ACCEPT`, `MAX_CACHE_BYTES`, `tagReduce`), `bin/fill-registry` unreferenced, `core-js` apparently unused (Babel is configured for `corejs: 2`, the package is 3; verify before removing).
- `npm audit`: 13 dev-only vulnerabilities (serialize-javascript, undici, braces/micromatch, js-yaml).
- Tracked runtime state under `examples/`: Keycloak DB files, a dev TLS key, an empty `acme.json`.
- `version-notification.riot` reads `self.tag_name` instead of `self.state.tag_name`, and its toast says "24 hours" while the check is weekly.
- Smaller defects in `docker-image.js` (empty manifest list, schema1, wrong variable in error messages), `bytesToSize` (1 PB+, `'0'`), router greedy regexes, `planRetention` accepting `NaN`, `AUTHENTICATE_HEADER_REGEX` ordering.
- Layout and polish: topbar overflow at 320–375px (_unverified_), snackbar over the selection bar on mobile, pixel-only type scale, duplicated search CSS, `font-display` missing on Material Symbols, heading outline starts at `h2`, pagination aria-labels.
- Documentation drift: Debian tag list, compose `version:` keys, historical design docs, site topbar brand says `docker-registry-ui`.

---

## Status after the follow-up pass

Every item was implemented by a fresh agent, attacked by an Opus adversarial reviewer
and merged only with CI green (including a new container smoke test on both images).

| PR | Covers |
|---|---|
| #26 | M-COR-1, 2, 7, 10; version-notification (state key, retry timing, https-only link); error-page `href` scheme check (part of M-SEC-6); router regexes |
| #27 | Reproducible-build dates and cosign/referrers tags protected in retention; M-COR-3, 4, 5, 6, 8, 9; M-SEC-5 (hash-verified cache, `drui:v2:` namespace); alias snapshot renewal; keep-newest no longer ranks index children |
| #28 | M-A11Y-1 to 7; pagination labels, heading outline, `font-display` |
| #29 | M-SEC-1 (DELETE denied unless `DELETE_IMAGES=true`), M-SEC-2 (CSP and friends, `CONTENT_SECURITY_POLICY`), M-SEC-3 (SHA-pinned actions, Dependabot, `--ignore-scripts`), M-SEC-4 (entrypoint escaping), M-BLD-2, 3, 5 |
| #30 | M-LIC-1, M-DOC-1/2, M-TST-1/2/3, dead code, `npm audit fix`, tracked runtime state untracked |
| #31 | Platform order of an index no longer depends on which fetch finishes first (the flaky "inspect every platform" test) |
| #25 | M-BLD-1 and M-TST-4 (release last, e2e before publishing) were done with the critical/high pass |

Behaviour changes worth knowing about:

- `DELETE_IMAGES` enables deletion only for the exact string `true`; `1`, `yes`, `True`
  no longer do. Without it the nginx proxy answers DELETE with 403. `docker push`
  through the proxy still works.
- A stored theme from before #28 is ignored once (new key `registryUiThemeChoice`).
- Keep-newest counts the N newest unprotected images; pattern tags, index children,
  cosign/referrers tags and images without a trustworthy date never use a slot.

### Still open

- **Needs your decision:** the TLS key and Keycloak DB under `examples/` are untracked
  but remain in git history. If the key was ever trusted anywhere, treat it as
  compromised; scrubbing history is a rewrite.
- **Repository admin:** branch protection on `main` (see below).
- **Nothing verified in a real browser or screen reader:** the dialog focus trap, live
  regions and `goHome()` are covered by jsdom tests only; the "Add registry" dialog does
  not return focus (its opener closes with the popover).
- **Retention:** the dialog's fresh alias check still costs one uncached manifest GET per
  tag; an index referenced only by digest cannot be found through the tag list; there is
  no UI toggle for `deleteCosignTags`.
- **Smaller:** `bin/fill-registry` is unreferenced;
  about 55 lines of unused `.switch` CSS; `MAX_CACHE_BYTES` unused; `core-js` is
  injected by a stale Babel `corejs: 2` config (fix the Babel config, not the
  dependency); 9 dev-only `npm audit` findings need breaking upgrades; no `HEALTHCHECK`
  and no non-root default; topbar overflow at 320 to 375px and the snackbar over the
  selection bar on mobile are unverified; text fields inside the registry-menu trigger
  still use `--border`; `M-SEC-6` mock registry still
  binds all interfaces with `ACAO: *`; the Keycloak example now starts from a blank
  realm.

## Requires a repository admin

Enable branch protection on `main`: require the `test` and `e2e` checks, require pull
requests, and block force pushes. Its absence is what let a failing-test merge
break `main` before (PR #19).
