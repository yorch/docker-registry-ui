/*
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
 * Project site behaviour: theme toggle, copy-to-clipboard, and table-of-contents
 * scroll tracking. No dependencies — this ships as-is to GitHub Pages.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
(() => {
  const STORAGE_KEY = 'drui-site:theme';

  /* ---------------------------------------------------------------- *
   * Theme. Uses the same `data-theme` attribute contract as the app
   * (see src/scripts/theme.js), so the two behave identically.
   * The inline script in <head> sets the initial value to avoid a flash;
   * this only wires the toggle.
   * ---------------------------------------------------------------- */
  const root = document.documentElement;

  const setTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Private browsing — the toggle still works for this page view. */
    }
  };

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // Follow the OS only while the visitor has expressed no preference of their own.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (!stored) {
      root.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    }
  });

  /* ---------------------------------------------------------------- *
   * Copy to clipboard
   * ---------------------------------------------------------------- */
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.getAttribute('data-copy'));
      if (!target) {
        return;
      }
      const label = button.querySelector('[data-copy-label]') || button;
      const original = label.textContent;
      try {
        await navigator.clipboard.writeText(target.innerText.trim());
        label.textContent = 'copied';
      } catch {
        // Clipboard is unavailable over plain HTTP and in some browsers.
        label.textContent = 'select & copy';
      }
      setTimeout(() => {
        label.textContent = original;
      }, 1600);
    });
  }

  /* ---------------------------------------------------------------- *
   * Table of contents — highlight the section currently in view.
   * ---------------------------------------------------------------- */
  const links = [...document.querySelectorAll('.toc a[href^="#"]')];
  if (links.length) {
    const byId = new Map(links.map((link) => [decodeURIComponent(link.hash.slice(1)), link]));
    const headings = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);

    if (headings.length) {
      const visible = new Set();

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              visible.add(entry.target.id);
            } else {
              visible.delete(entry.target.id);
            }
          }
          // Mark the topmost visible heading; fall back to the last one passed.
          const active =
            headings.find((heading) => visible.has(heading.id)) ||
            [...headings].reverse().find((heading) => heading.getBoundingClientRect().top < 120);

          for (const link of links) {
            link.classList.remove('is-active');
          }
          if (active) {
            byId.get(active.id)?.classList.add('is-active');
          }
        },
        { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
      );

      for (const heading of headings) {
        observer.observe(heading);
      }
    }
  }
})();
