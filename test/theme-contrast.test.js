/*
 * The palette is the one place contrast can be checked without a browser, so
 * the thresholds live in a test: white text on the danger surfaces and the
 * muted text colour need 4.5:1, control boundaries need 3:1 (WCAG 1.4.3, 1.4.11).
 */
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(new URL('../src/styles/tokens.scss', import.meta.url), 'utf8');

const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
const tokens = (selector) =>
  Object.fromEntries([...block(selector).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));

const channel = (hex, i) => {
  const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = { light: { ...tokens(':root') }, dark: { ...tokens(':root'), ...tokens("[data-theme='dark']") } };

for (const [name, t] of Object.entries(themes)) {
  describe(`${name} theme contrast`, () => {
    it('should keep on-danger text at 4.5:1 on the danger background and its hover', () => {
      assert.ok(ratio(t['on-danger'], t['danger-bg']) >= 4.5);
      assert.ok(ratio(t['on-danger'], t['danger-bg-hover']) >= 4.5);
    });

    for (const surface of ['bg', 'surface', 'surface-muted', 'surface-hover']) {
      it(`should keep --text-muted at 4.5:1 on --${surface}`, () => {
        assert.ok(ratio(t['text-muted'], t[surface]) >= 4.5, `${ratio(t['text-muted'], t[surface])}`);
      });
    }

    for (const surface of ['surface', 'surface-muted', 'surface-hover']) {
      it(`should keep --border-strong at 3:1 on --${surface}`, () => {
        assert.ok(ratio(t['border-strong'], t[surface]) >= 3, `${ratio(t['border-strong'], t[surface])}`);
      });
    }
  });
}

/*
 * --border is a decorative divider (1.29:1 on surface in light, 1.39:1 in
 * dark). Anything a user has to find and operate -- a field, a select, a
 * button, the registry trigger pill -- draws its boundary with --border-strong,
 * or the contrast checks above guard nothing.
 */
const CONTROL = /input|select|textarea|trigger|field|checkbox|switch|toggle|chip|pill|\.btn\b|button/;
const DIVIDER = /(?:^|-)(?:border(?:-[a-z]+)*|outline(?:-[a-z]+)?|box-shadow)$/;
const USES_DIVIDER = /var\(\s*--border\s*[,)]/;

// Walks CSS (SCSS nesting included) and returns the full selector chain of
// every control rule that paints a boundary with the --border divider token.
const dividerOnControls = (css) => {
  const offenders = [];
  const stack = [];
  let buffer = '';
  const declarations = (text) => text.split(';').map((d) => d.split(/:(.*)/s));
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') {
      const parts = buffer.split(';');
      stack.push(parts[parts.length - 1].trim());
      const complete = parts.slice(0, -1).join(';');
      check(complete);
      buffer = '';
    } else if (ch === '}') {
      check(buffer);
      stack.pop();
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  function check(body) {
    const chain = stack.join(' ');
    if (!CONTROL.test(chain)) {
      return;
    }
    for (const [prop, value] of declarations(body)) {
      if (prop && value && DIVIDER.test(prop.trim()) && USES_DIVIDER.test(value)) {
        offenders.push(`${chain} { ${prop.trim()}: ${value.trim()} }`);
      }
    }
  }
  return offenders;
};

describe('control borders', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : /\.(scss|riot)$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    );

  it('should not draw the boundary of a form control or trigger with --border', () => {
    const offenders = [];
    for (const file of walk(fileURLToPath(new URL('../src', import.meta.url)))) {
      const text = readFileSync(file, 'utf8');
      const source = file.endsWith('.riot')
        ? text.includes('<style>')
          ? text.slice(text.indexOf('<style>'))
          : ''
        : text;
      offenders.push(...dividerOnControls(source).map((o) => `${file}: ${o}`));
    }
    assert.deepEqual(offenders, []);
  });

  describe('the scan itself', () => {
    const flagged = {
      border: '.btn { border: 1px solid var(--border); }',
      'border-bottom': '.text-field { border-bottom: 1px solid var(--border); }',
      'border-top': 'input { border-top: 1px solid var(--border); }',
      'border-left': 'select { border-left: 1px solid var(--border); }',
      'inset box-shadow': '.btn { box-shadow: inset 0 0 0 1px var(--border); }',
      outline: '.btn { outline: 1px solid var(--border); }',
      'var with fallback': '.registry-trigger { border: 1px solid var(--border, #ccc); }',
      'nested hover': '.btn { color: red; &:hover { border-color: var(--border); } }',
      'nested after other rules': '.btn { &:focus { color: red; } &:hover { border-color: var(--border); } }',
      'other class name': '.search-pill { border: 1px solid var(--border); }',
      'riot :host selector': ':host .registry-trigger { border: 1px solid var(--border); }',
    };
    for (const [name, css] of Object.entries(flagged)) {
      it(`should flag ${name}`, () => {
        assert.equal(dividerOnControls(css).length, 1, css);
      });
    }

    it('should leave dividers, strong borders and similarly named tokens alone', () => {
      assert.deepEqual(dividerOnControls('.panel { border: 1px solid var(--border); }'), []);
      assert.deepEqual(dividerOnControls('.btn { border: 1px solid var(--border-strong); }'), []);
      assert.deepEqual(dividerOnControls('.btn { border: 1px solid var(--border-strong, #888); }'), []);
      assert.deepEqual(dividerOnControls('.btn { background: var(--border); }'), []);
    });
  });
});
