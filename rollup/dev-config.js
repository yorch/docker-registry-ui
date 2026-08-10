/*
 * Fills the `${VAR}` placeholders in index.html for the dev server.
 *
 * The names are deliberately the ones the published container already uses, so
 * there is one vocabulary: what you set here is what you would set on the image.
 * In a production build the container's entrypoint does this substitution at
 * startup instead, which is why this only ever runs in serve mode -- baking
 * values in at build time would ship a container that ignores its own settings.
 */

const DEV_DEFAULTS = {
  APP_NAME: '',
  DOCKER_REGISTRY_UI_TITLE: '',
  REGISTRY_TITLE: 'Development Registry',
  PULL_URL: '',
  SHOW_CONTENT_DIGEST: 'true',
  SHOW_TAG_HISTORY: 'true',
  DELETE_IMAGES: 'true',
  CATALOG_ELEMENTS_LIMIT: '1000',
  SINGLE_REGISTRY: 'false',
  DEFAULT_REGISTRIES: '',
  READ_ONLY_REGISTRIES: 'false',
  SHOW_CATALOG_NB_TAGS: 'true',
  HISTORY_CUSTOM_LABELS: '',
  USE_CONTROL_CACHE_HEADER: 'false',
  TAGLIST_ORDER: '',
  CATALOG_DEFAULT_EXPANDED: '',
  CATALOG_MIN_BRANCHES: '1',
  CATALOG_MAX_BRANCHES: '1',
  REGISTRY_SECURED: 'false',
  THEME: 'auto',
  THEME_PRIMARY_TEXT: '',
  THEME_NEUTRAL_TEXT: '',
  THEME_BACKGROUND: '',
  THEME_HOVER_BACKGROUND: '',
  THEME_ACCENT_TEXT: '',
  THEME_HEADER_ACCENT_TEXT: '',
  THEME_HEADER_TEXT: '',
  THEME_HEADER_BACKGROUND: '',
  THEME_FOOTER_TEXT: '',
  THEME_FOOTER_NEUTRAL_TEXT: '',
  THEME_FOOTER_BACKGROUND: '',
  TAGLIST_PAGE_SIZE: '',
  // Off by default in dev: it calls api.github.com on every load, which is a
  // request you did not ask for and noise in the network panel.
  ENABLE_VERSION_NOTIFICATION: 'false',
};

export const devConfig = (overrides = {}) => ({ ...DEV_DEFAULTS, ...overrides });

// Unknown placeholders resolve to an empty string rather than being left as
// literal `${FOO}`, which would otherwise reach the browser as an attribute
// value and be read as a real setting.
export const applyDevConfig = (html, config) =>
  html.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => (name in config ? config[name] : ''));
