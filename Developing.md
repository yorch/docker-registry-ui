# How to build Docker Registry UI

This file contains tips to help you take (and understand) your first steps in Docker Registry UI development.

## Clone and install the repository

```bash
git clone https://github.com/Joxit/docker-registry-ui.git
cd docker-registry-ui
npm install
```

## Run the local server

```bash
npm start
```

Open your browser <http://localhost:8000> you can configure your options by updating the `src/index.html` file.

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