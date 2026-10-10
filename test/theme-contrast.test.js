/*
 * The palette is the one place contrast can be checked without a browser, so
 * the thresholds live in a test: white text on the danger surfaces and the
 * muted text colour need 4.5:1, control boundaries need 3:1 (WCAG 1.4.3, 1.4.11).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

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

    for (const surface of ['surface', 'surface-muted']) {
      it(`should keep --border-strong at 3:1 on --${surface}`, () => {
        assert.ok(ratio(t['border-strong'], t[surface]) >= 3, `${ratio(t['border-strong'], t[surface])}`);
      });
    }
  });
}
