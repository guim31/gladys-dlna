// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the manifest `config_schema`; fetched with
// `gladys.getConfig()` and pushed again through `gladys.onConfigUpdated()`.
// This module only provides the defaults and normalizes what arrives.
// -----------------------------------------------------------------------------

import { isHttpUrl } from './upnp/http.js';
import { LANGUAGES } from './i18n.js';

export { LANGUAGES };

// Favorites: the config_schema grammar has no list, so each favorite is a
// numbered group of fields (`favorite_<n>_<field>`), keys frozen once
// published like every config key.
export const MAX_FAVORITES = 8;
export const FAVORITE_SLOTS = Array.from({ length: MAX_FAVORITES }, (_, i) => String(i + 1));
export const FAVORITE_FIELDS = ['name', 'url', 'server', 'search_by', 'query', 'mode'];
export const favoriteKey = (slot, field) => `favorite_${slot}_${field}`;

const FAVORITE_DEFAULTS = {
  name: '',
  url: '',
  server: '',
  search_by: 'any',
  query: '',
  mode: 'all',
};

// MUST stay consistent with the `default` values of the manifest config_schema.
export const DEFAULT_CONFIG = {
  // Description URLs typed by hand, for the devices SSDP cannot find (another
  // subnet, a VLAN, a device that does not answer searches).
  description_urls: '',
  // Language of the feature names published at discovery and of the errors
  // thrown to the core: an integration of type "device" never learns the
  // user's language.
  language: 'en',
  ...Object.fromEntries(
    FAVORITE_SLOTS.flatMap((slot) =>
      FAVORITE_FIELDS.map((field) => [favoriteKey(slot, field), FAVORITE_DEFAULTS[field]]),
    ),
  ),
};

/** The http(s) URLs of a free-text list (commas, spaces or new lines). */
export function parseUrlList(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter((entry) => isHttpUrl(entry)),
    ),
  ];
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  const strings = Object.fromEntries(
    Object.entries(DEFAULT_CONFIG).map(([key, fallback]) => [
      key,
      typeof fallback === 'string' && config[key] !== undefined && config[key] !== null
        ? String(config[key]).trim()
        : fallback,
    ]),
  );
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ...strings,
    description_urls: String(config.description_urls ?? DEFAULT_CONFIG.description_urls),
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
