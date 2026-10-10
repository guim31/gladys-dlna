// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the manifest `config_schema`; fetched with
// `gladys.getConfig()` and pushed again through `gladys.onConfigUpdated()`.
// This module only provides the defaults and normalizes what arrives.
// -----------------------------------------------------------------------------

import { isHttpUrl } from './upnp/http.js';

// MUST stay consistent with the `default` values of the manifest config_schema.
export const DEFAULT_CONFIG = {
  // Description URLs typed by hand, for the devices SSDP cannot find (another
  // subnet, a VLAN, a device that does not answer searches).
  description_urls: '',
  // Language of the feature names published at discovery: an integration of
  // type "device" never learns the user's language.
  language: 'en',
};

export const LANGUAGES = ['en', 'fr'];

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
  return {
    ...DEFAULT_CONFIG,
    ...config,
    description_urls: String(config.description_urls ?? DEFAULT_CONFIG.description_urls),
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
