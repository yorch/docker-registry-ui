/*
 * Auto theme used to freeze after the first visit: loadTheme persisted the
 * value it had just computed from the OS preference, and the next visit read
 * that back before ever asking matchMedia. Only an explicit choice (the toggle)
 * may be remembered.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { loadTheme, saveThemeChoice } from '../src/scripts/theme.js';

const osPrefersDark = (dark) => {
  window.matchMedia = () => ({ matches: dark });
};

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('should follow the OS preference in auto mode', () => {
    osPrefersDark(true);
    assert.equal(loadTheme({ theme: 'auto' }, document.body.style), 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
  });

  it('should not persist the computed theme', () => {
    osPrefersDark(true);
    loadTheme({ theme: 'auto' }, document.body.style);
    assert.equal(localStorage.length, 0);
  });

  it('should follow a changed OS preference on the next visit', () => {
    osPrefersDark(false);
    assert.equal(loadTheme({ theme: 'auto' }, document.body.style), 'light');
    osPrefersDark(true);
    assert.equal(loadTheme({ theme: 'auto' }, document.body.style), 'dark');
  });

  it('should remember an explicit choice over the OS preference', () => {
    osPrefersDark(true);
    saveThemeChoice('light');
    assert.equal(loadTheme({ theme: 'auto' }, document.body.style), 'light');
  });

  it('should ignore a remembered choice when the operator pins a theme', () => {
    osPrefersDark(false);
    saveThemeChoice('light');
    assert.equal(loadTheme({ theme: 'dark' }, document.body.style), 'dark');
  });

  it('should have a style rule reading every documented header and footer token', () => {
    // THEME_HEADER_* / THEME_FOOTER_* are documented; each has to be read by a rule.
    const layout = readFileSync(new URL('../src/styles/layout.scss', import.meta.url), 'utf8');
    for (const name of [
      'header-text',
      'header-accent-text',
      'header-background',
      'footer-text',
      'footer-neutral-text',
      'footer-background',
    ]) {
      assert.ok(layout.includes(`var(--${name},`), `--${name} is not read by layout.scss`);
    }
  });
});
