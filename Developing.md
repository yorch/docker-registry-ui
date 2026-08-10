# How to build Registry Explorer

This file contains tips to help you take (and understand) your first steps in Registry Explorer development.

## Clone and install the repository

```bash
git clone https://github.com/yorch/docker-registry-ui.git
cd docker-registry-ui
npm ci
```

`npm ci` installs from the committed lockfile, which is what the Dockerfile and
CI use.

## Run the local server

```bash
npm start
```

Open <http://localhost:8000>. You get a populated interface straight away: with no
`REGISTRY_URL` set, a mock registry starts alongside the dev server on port 5555
and serves a catalogue built for developing against.

### Configuration

Settings come from the environment, using the same variable names as the
published container, so what you set here is what you would set on the image:

```bash
TAGLIST_PAGE_SIZE=10 DELETE_IMAGES=false npm start
```

Defaults live in `rollup/dev-config.js`. There is no need to edit
`src/index.html` — its dev block reads these variables.

Useful ones: `REGISTRY_URL`, `TAGLIST_PAGE_SIZE`, `DELETE_IMAGES`,
`SHOW_CONTENT_DIGEST`, `SHOW_TAG_HISTORY`, `CATALOG_ELEMENTS_LIMIT`, `THEME`.

### The mock registry

`dev/mock-registry/` implements the endpoints the UI calls: the catalogue, tag
lists, manifests, config blobs, and delete. Manifests are hashed with sha256
over the exact bytes served, so content addressing, `Docker-Content-Digest`,
caching and delete-by-digest behave as they do against a real registry.

Every repository in the catalogue exists to demonstrate one thing:

| Repository | What it is for |
| --- | --- |
| `nginx` | An ordinary repository. The baseline. |
| `team/service-a`, `team/service-b` | Nested names, for the catalogue branching options |
| `huge` | 1000 tags: pagination, and making the request fan-out visible |
| `exactly-100` | Exactly one default page, the boundary that used to render an empty second page |
| `empty` | No tags at all, for the empty state |
| `oci-index` | A multi-architecture OCI index, for the architectures column |
| `broken-manifest` | Lists tags but every manifest 404s, for the unavailable state |
| `no-digest-header` | Omits `Docker-Content-Digest`, forcing the SHA-256 fallback |
| `slow` | Delayed responses, so loading states stay on screen long enough to look at |

Add an edge case by adding a repository to `dev/mock-registry/fixtures.js`. The
server should not need touching.

Two knobs:

```bash
MOCK_LATENCY_MS=300 npm start     # delay every response, to open up race windows
MOCK_REGISTRY_PORT=6000 npm start # if 5555 is taken
```

Latency is worth reaching for: several bugs in this UI only appear while a
request is still in flight, and are invisible against an instant local backend.

The mock is a plain module, so a test or script can start one directly:

```js
import { createMockRegistry } from './dev/mock-registry/server.js';
const registry = await createMockRegistry({ port: 0 }); // 0 picks a free port
// registry.url, then registry.close()
```

### Developing against a real registry

Set `REGISTRY_URL` and the mock stays out of the way:

```bash
REGISTRY_URL=http://localhost:5000 npm start
```

The registry needs CORS for the dev server's origin, which is
`http://localhost:8000` — not `http://localhost`, the value in the
`examples/` configs:

```yaml
http:
  headers:
    Access-Control-Allow-Origin: ['http://localhost:8000']
    Access-Control-Allow-Methods: ['HEAD', 'GET', 'OPTIONS', 'DELETE']
    Access-Control-Expose-Headers: ['Docker-Content-Digest']
storage:
  delete:
    enabled: true
```

`Access-Control-Expose-Headers` matters more than it looks: without it the
browser hides the header and the UI quietly falls back to hashing the response
body, so you end up testing a different code path than the one that runs in
production.

Note that port 5000, the usual registry port, is taken by AirPlay Receiver on
macOS.

## Run the tests

```bash
npm test
```

Tests live in `test/` and run on [mocha](https://mochajs.org). Plain modules from
`src/scripts` are imported directly.

Riot components are testable too. `test/setup/register.js` installs a jsdom
document and a loader hook that compiles `.riot` files on import, so a component
can be mounted and driven like it is in the browser:

```js
import { component } from 'riot';
import AppCheckbox from '../src/components/app-checkbox.riot';

const root = document.createElement('div');
document.body.appendChild(root);
const instance = component(AppCheckbox)(root, { onChange: (event) => /* ... */ });
```

Call `instance.update()` to run a render pass, and read `instance.root` for the
rendered DOM. Note that `dispatchEvent` invokes listeners even on a disabled
control, so use `element.click()` when a test depends on `disabled` being
honoured.

### End-to-end tests

```bash
npx playwright install chromium   # once
npm run test:e2e
```

These drive a real browser against the mock registry. They start `npm start`
themselves, so nothing else may be listening on port 8000 — the run aborts
rather than testing against a server it did not start.

They live in `test/e2e/` and are deliberately kept few. Their job is the class
of bug that a green unit suite has repeatedly let through here: a tag table that
rendered empty once responses came from cache, a component that kept the
previous repository's tags after the route changed, cells that claimed to be
loading forever. Each needed a real document, a real cache and real requests to
show up at all.

`npm test` does not run them: mocha's default spec does not descend into
`test/e2e/`, so the fast suite stays fast and needs no browser. CI runs them as
a separate job.