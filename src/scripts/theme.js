/*
 * Copyright (C) 2016-2023 Jones Magloire @Joxit
 *
 * Theme handling for Registry Explorer.
 *
 * The light and dark palettes live in `src/styles/tokens.scss` and are
 * selected by setting `data-theme` on the root element. This module decides
 * which theme to use (auto / light / dark) and applies `THEME_*` environment
 * overrides on top, keeping the legacy variables (`--primary-text`, ...)
 * and the modern tokens they alias in sync.
 */

// Holds only a theme the user picked with the toggle. It used to be
// `registryUiTheme` and was written on every load with whatever had been
// computed, so the OS preference was frozen after the first visit. The key is
// new so those stale computed values are not mistaken for choices.
const LOCAL_STORAGE_THEME = 'registryUiThemeChoice';

/**
 * Mapping from legacy theme variable (as exposed by `THEME_*` env vars) to
 * the modern token it aliases. Overrides are written to both so existing
 * configuration keeps working and modern-styled components see the value.
 */
const LEGACY_TO_MODERN = {
  'primary-text': 'text-primary',
  'neutral-text': 'text-secondary',
  'background': 'surface',
  'hover-background': 'surface-hover',
  'accent-text': 'accent',
  'header-text': 'header-text',
  'header-accent-text': 'header-accent-text',
  'header-background': 'header-background',
  'footer-text': 'footer-text',
  'footer-neutral-text': 'footer-neutral-text',
  'footer-background': 'footer-background',
};

const normalizeKey = (k) =>
  k
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^theme-/, '');

const readThemeChoice = () => {
  try {
    return localStorage.getItem(LOCAL_STORAGE_THEME);
  } catch {
    return null;
  }
};

/** Remember an explicit light/dark choice; the computed theme is never stored. */
export const saveThemeChoice = (theme) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_THEME, theme);
  } catch {
    // Storage can be blocked; the choice then lasts for the session only.
  }
};

const preferDarkMode = ({ theme }) => {
  if (theme === 'auto' || theme === '') {
    switch (readThemeChoice()) {
      case 'dark':
        return true;
      case 'light':
        return false;
      default:
        if (typeof window.matchMedia === 'function') {
          const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
          return prefersDarkScheme?.matches;
        }
    }
  }
  return theme === 'dark';
};

export const loadTheme = (props, style) => {
  const isDarkMode = preferDarkMode(props);
  const theme = isDarkMode ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  // Apply THEME_* environment overrides to both the legacy variable and the
  // modern token it maps to. Defaults come from tokens.scss.
  Object.entries(props)
    .filter(([k, v]) => v && /^theme[A-Z]/.test(k))
    .forEach(([k, v]) => {
      const key = normalizeKey(k);
      style.setProperty(`--${key}`, v);
      const modern = LEGACY_TO_MODERN[key];
      if (modern) {
        style.setProperty(`--${modern}`, v);
      }
    });
  return theme;
};
