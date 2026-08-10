/*
 * Copyright (C) 2026 Jorge Barnaby @yorch
 *
 * Builds the project site into site/_build/.
 *
 * The documentation page is GENERATED FROM README.md rather than hand-written.
 * The README is the canonical reference — it is what people read on GitHub and
 * what the in-app error page links to — so duplicating ~200 lines of options
 * reference into HTML would guarantee the two drift apart. Add a section to the
 * README and it appears here; there is nothing to keep in sync by hand.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, '_build');

const SITE_URL = 'https://yorch.github.io/docker-registry-ui';
const REPO_URL = 'https://github.com/yorch/docker-registry-ui';
const UPSTREAM_URL = 'https://github.com/Joxit/docker-registry-ui';
const IMAGE = 'ghcr.io/yorch/docker-registry-ui';

/*
 * README sections published as documentation, in the order they should appear.
 * Anything not listed here (the fork notice, "Changes from upstream", the
 * project-page link line, Development, License) stays on GitHub only — it is
 * repository context rather than operator documentation.
 */
const DOC_SECTIONS = [
  'Supported Docker tags',
  'Hidden Features',
  'Available options',
  'Recommended Docker Registry Usage',
  'Using CORS',
  'Using delete',
  'Registry example',
  'Standalone Application',
  'FAQ',
];

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/*
 * Slugs must match GitHub's own algorithm: the README's headings are already
 * linked as #faq and #available-options from the app's error page and from
 * within the README itself, so a different scheme would break those links the
 * moment someone lands on the hosted docs instead of GitHub.
 */
const slugify = (text) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-');

/** Split a markdown document into `##` sections keyed by title. */
const splitSections = (markdown) => {
  const sections = new Map();
  const lines = markdown.split('\n');
  let title = null;
  let buffer = [];
  let inFence = false;

  const flush = () => {
    if (title) {
      sections.set(title, buffer.join('\n').trim());
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
    }
    // A `##` inside a fenced block is code, not a heading.
    const heading = !inFence && /^## (?!#)(.+)$/.exec(line);
    if (heading) {
      flush();
      title = heading[1].trim();
      buffer = [];
    } else if (title) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
};

/** Add id attributes to h2/h3 and make wide tables scroll inside themselves. */
const enrich = (html) =>
  html
    .replace(/<h([23])>(.*?)<\/h\1>/gs, (_match, level, inner) => {
      const id = slugify(inner.replace(/<[^>]+>/g, ''));
      return `<h${level} id="${id}">${inner}</h${level}>`;
    })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');

const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  layers: icon('<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
  github: icon(
    '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0 0 19.8 5a4.9 4.9 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.7 12.7 0 0 0-6.8 0C6.6 1.1 5.5 1.4 5.5 1.4A4.9 4.9 0 0 0 5.4 5a5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.2 6.4 6.2 6.7A3.4 3.4 0 0 0 9.2 18v4"/>'
  ),
  book: icon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>'),
  sun: icon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  ),
  moon: icon('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
  trash: icon('<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  shield: icon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>'),
  cpu: icon('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>'),
  bolt: icon('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  palette: icon('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9.5" cy="14.5" r="1"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.5"/>'),
};

/** The shared page shell. */
const layout = ({ title, description, page, body, canonical }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_URL}/screenshot.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="./favicon.ico" />
    <link rel="stylesheet" href="./styles.css" />
    <script>
      // Set the theme before first paint so there is no flash of the wrong one.
      (() => {
        let stored = null;
        try { stored = localStorage.getItem('drui-site:theme'); } catch {}
        const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      })();
    </script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="topbar">
      <div class="wrap">
        <a class="brand" href="./index.html">
          <span class="brand-mark">${ICONS.layers}</span>
          <span>docker-registry-ui</span>
        </a>
        <nav class="nav" aria-label="Main">
          <a href="./index.html"${page === 'home' ? ' aria-current="page"' : ''}>Home</a>
          <a href="./docs.html"${page === 'docs' ? ' aria-current="page"' : ''}>Docs</a>
          <a class="nav-github" href="${REPO_URL}" rel="noopener">
            <span class="nav-icon" aria-hidden="true">${ICONS.github}</span><span class="nav-text">GitHub</span>
          </a>
          <button class="icon-btn" type="button" data-theme-toggle aria-label="Switch theme">
            <span class="icon-light">${ICONS.moon}</span>
            <span class="icon-dark">${ICONS.sun}</span>
          </button>
        </nav>
      </div>
    </header>
    <main id="main">
${body}
    </main>
    <footer class="footer">
      <div class="wrap">
        <p>
          A fork of <a href="${UPSTREAM_URL}" rel="noopener">Joxit/docker-registry-ui</a>,
          maintained independently. Licensed AGPL-3.0.
        </p>
        <div class="links">
          <a href="./docs.html">Documentation</a>
          <a href="${REPO_URL}" rel="noopener">Source</a>
          <a href="${REPO_URL}/blob/main/LICENSE" rel="noopener">AGPL-3.0</a>
          <a href="${REPO_URL}/pkgs/container/docker-registry-ui" rel="noopener">Container image</a>
        </div>
      </div>
    </footer>
    <script src="./site.js"></script>
  </body>
</html>
`;

/* ------------------------------------------------------------------ *
 * Landing page
 * ------------------------------------------------------------------ */
const feature = (iconName, heading, copy) => `
          <article class="card">
            <div class="card-icon">${ICONS[iconName]}</div>
            <h3>${heading}</h3>
            <p>${copy}</p>
          </article>`;

const homeBody = `
      <section class="hero">
        <div class="wrap">
          <p class="eyebrow reveal"><span class="dot"></span> AGPL-3.0 · published to GHCR</p>
          <h1 class="reveal">Browse your private<br /><span class="accent">Docker registry.</span></h1>
          <p class="lede reveal">
            A fast, dependency-free web interface for a private Docker registry. Browse the catalog,
            inspect manifests and layer history, and delete tags — served by nginx from a container
            that starts in one command.
          </p>
          <div class="cta-row reveal">
            <a class="btn btn-primary" href="#quick-start">${ICONS.bolt} Quick start</a>
            <a class="btn btn-ghost" href="./docs.html">${ICONS.book} Documentation</a>
            <a class="btn btn-ghost" href="${REPO_URL}" rel="noopener">${ICONS.github} GitHub</a>
          </div>

          <div class="terminal reveal">
            <div class="terminal-bar">
              <span class="lamp"></span><span class="lamp"></span><span class="lamp"></span>
              <span class="label">run it</span>
              <button class="copy" type="button" data-copy="run-cmd">
                <span data-copy-label>copy</span>
              </button>
            </div>
            <pre id="run-cmd"><span class="prompt">$</span> docker run -d -p 8080:80 \\
    <span class="flag">-e</span> REGISTRY_URL=https://registry.example.com \\
    <span class="flag">-e</span> SINGLE_REGISTRY=true \\
    ${IMAGE}:latest</pre>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head center">
            <p class="section-label">The interface</p>
            <h2>Everything in the registry, at a glance</h2>
            <p>
              A catalog that groups repositories by namespace, tag lists with size and creation
              date, full layer history, and multi-architecture support.
            </p>
          </div>
          <div class="shot">
            <div class="shot-bar">
              <span class="lamp"></span><span class="lamp"></span><span class="lamp"></span>
              <span class="url">registry.example.com</span>
            </div>
            <img
              src="./screenshot.png"
              width="2880"
              height="1240"
              alt="The Registry Explorer catalog, showing repositories grouped by namespace with tag-count badges"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <p class="section-label">Capabilities</p>
            <h2>Built for operators</h2>
            <p>Data-dense where it matters, and configured entirely through environment variables.</p>
          </div>
          <div class="grid">
${feature('trash', 'Delete tags in bulk', `Select with checkboxes, <kbd>Alt</kbd>&nbsp;+&nbsp;Click for a whole page, or <kbd>Shift</kbd>&nbsp;+&nbsp;Click for a range. Off by default until you set <code>DELETE_IMAGES</code>.`)}
${feature('layers', 'Layer history', 'Inspect image history, environment, and the commands behind each layer — including the Dockerfile where it is recorded.')}
${feature('cpu', 'Multi-architecture', 'Manifest lists and OCI image indexes are expanded, so you can see every architecture published under one tag.')}
${feature('search', 'Search and sort', `Filter repositories and tags as you type. Tag sorting understands numbers, so <code>v10</code> lands after <code>v9</code>.`)}
${feature('bolt', 'Bounded requests', 'Tag lists are cached and outbound requests are pooled, so a catalog with hundreds of tags does not flood your registry.')}
${feature('palette', 'Themeable', `Light and dark out of the box, plus <code>THEME_*</code> variables to recolour the interface without rebuilding.`)}
          </div>
        </div>
      </section>

      <section class="section" id="quick-start">
        <div class="wrap">
          <div class="section-head">
            <p class="section-label">Quick start</p>
            <h2>Running in three steps</h2>
            <p>
              The image is published to GHCR for <code>linux/amd64</code> and <code>linux/arm64</code>,
              on both an Alpine and a Debian base.
            </p>
          </div>
          <div class="steps">
            <div class="step">
              <h3>Pull the image</h3>
              <p>Tags follow the release line: <code>latest</code>, <code>2</code>, <code>2.7</code>, <code>2.7.0</code>, each with a <code>-debian</code> variant.</p>
              <div class="code-block"><pre>docker pull ${IMAGE}:latest</pre></div>
            </div>
            <div class="step">
              <h3>Point it at your registry</h3>
              <p>Every option is an environment variable, substituted at container start — no rebuild needed.</p>
              <div class="code-block"><pre>docker run -d -p 8080:80 \\
  -e REGISTRY_URL=https://registry.example.com \\
  -e DELETE_IMAGES=true \\
  ${IMAGE}:latest</pre></div>
            </div>
            <div class="step">
              <h3>Or use compose</h3>
              <p>Run the UI beside a registry, with the UI proxying it to sidestep CORS entirely.</p>
              <div class="code-block"><pre>services:
  ui:
    image: ${IMAGE}:latest
    ports: ['8080:80']
    environment:
      - SINGLE_REGISTRY=true
      - NGINX_PROXY_PASS_URL=http://registry:5000</pre></div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="notice">
            ${ICONS.info}
            <div>
              <p>
                <strong>This is a fork.</strong> It builds on
                <a href="${UPSTREAM_URL}" rel="noopener">Joxit/docker-registry-ui</a> and is maintained
                independently — not affiliated with or endorsed by the original author.
              </p>
              <p>
                It differs mainly in a redesigned interface, images published to GHCR rather than
                Docker Hub, and a narrowed build matrix. The full list is in the
                <a href="${REPO_URL}#changes-from-upstream" rel="noopener">README</a>.
              </p>
            </div>
          </div>
        </div>
      </section>
`;

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */
const build = async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf-8');
  const sections = splitSections(readme);

  const missing = DOC_SECTIONS.filter((name) => !sections.has(name));
  if (missing.length) {
    // Fail loudly: a renamed README heading would otherwise silently drop a
    // whole page of documentation from the site.
    throw new Error(
      `README.md is missing expected section(s): ${missing.join(', ')}.\n` +
        `Update DOC_SECTIONS in site/build.mjs if a heading was renamed on purpose.`
    );
  }

  const docMarkdown = DOC_SECTIONS.map((name) => `## ${name}\n\n${sections.get(name)}`).join('\n\n');
  const docHtml = enrich(marked.parse(docMarkdown));

  // The contents list mirrors the section order, with `###` children nested.
  const toc = DOC_SECTIONS.map((name) => {
    const children = [...sections.get(name).matchAll(/^### (?!#)(.+)$/gm)].map((match) => match[1].trim());
    const sub = children.length
      ? `<ul class="sub">${children
          .map((child) => `<li><a href="#${slugify(child)}">${escapeHtml(child)}</a></li>`)
          .join('')}</ul>`
      : '';
    return `<li><a href="#${slugify(name)}">${escapeHtml(name)}</a>${sub}</li>`;
  }).join('\n            ');

  const docsBody = `
      <div class="wrap">
        <div class="docs">
          <aside class="toc" aria-label="Contents">
            <h2>Contents</h2>
            <ul>
            ${toc}
            </ul>
          </aside>
          <article class="prose">
            ${docHtml}
            <p class="docs-foot">
              This page is generated from
              <a href="${REPO_URL}/blob/main/README.md" rel="noopener">README.md</a>, which is the
              canonical reference. Spotted something wrong? Edit it there.
            </p>
          </article>
        </div>
      </div>
`;

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await cp(join(here, 'static'), out, { recursive: true });
  await mkdir(join(out, 'fonts'), { recursive: true });
  for (const font of ['IBMPlexSans.ttf', 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-Medium.ttf', 'IBMPlexMono-SemiBold.ttf']) {
    await cp(join(root, 'src', 'fonts', font), join(out, 'fonts', font));
  }
  await cp(join(root, 'screenshot.png'), join(out, 'screenshot.png'));
  await cp(join(root, 'favicon.ico'), join(out, 'favicon.ico'));

  await writeFile(
    join(out, 'index.html'),
    layout({
      title: 'Registry Explorer — a web interface for your private registry',
      description:
        'A fast, dependency-free web interface for a private Docker registry. Browse the catalog, inspect layer history, and delete tags.',
      page: 'home',
      canonical: `${SITE_URL}/`,
      body: homeBody,
    })
  );

  await writeFile(
    join(out, 'docs.html'),
    layout({
      title: 'Documentation — Registry Explorer',
      description:
        'Configuration reference for Registry Explorer: environment variables, theming, CORS, deletion, and worked registry examples.',
      page: 'docs',
      canonical: `${SITE_URL}/docs.html`,
      body: docsBody,
    })
  );

  console.log(`Site built to ${out}`);
  console.log(`  index.html   landing page`);
  console.log(`  docs.html    ${DOC_SECTIONS.length} sections generated from README.md`);
};

build().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
