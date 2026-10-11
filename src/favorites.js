// -----------------------------------------------------------------------------
// Favorites: up to 8 media the user names in the configuration, played from
// a dashboard widget or a scene action.
//
// A favorite is either an http(s) URL (a web radio, a file) or a search on a
// media server, the same as the "Play a media server" scene action (a
// folder, an album, a playlist…). The configuration has no list type: each
// favorite is a numbered group of fields (see config.js). Its server is named,
// not picked in a device list: a config select must hold one of the current
// options, so a cleared choice or a deleted server would make the core refuse
// every later save of the configuration (422).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { FAVORITE_SLOTS, favoriteKey } from './config.js';
import { isHttpUrl } from './upnp/http.js';
import { SEARCH_BY, normalizeText } from './upnp/server.js';
import { DEVICE_KINDS, parseDeviceExternalId } from './devices/index.js';
import { PLAY_MODES, languageOf, playFromServer, requireRenderer } from './playback.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'favorites' });

export const FAVORITE_KINDS = { URL: 'url', SERVER: 'server' };

/** A short name for a favorite left unnamed: the host of its URL, or its search. */
function defaultName(favorite) {
  if (favorite.kind === FAVORITE_KINDS.URL) {
    return new URL(favorite.url).hostname;
  }
  return favorite.query;
}

/**
 * The favorite of one slot ('1' to '8'), or null when it is not configured.
 * A URL wins over a server search when both are filled.
 */
export function favoriteOf(config, slot) {
  const field = (name) => String(config?.[favoriteKey(slot, name)] ?? '').trim();
  const url = field('url');
  const server = field('server');
  const query = field('query');
  let favorite;
  if (isHttpUrl(url)) {
    favorite = { slot, kind: FAVORITE_KINDS.URL, url };
  } else if (query) {
    favorite = {
      slot,
      kind: FAVORITE_KINDS.SERVER,
      server,
      by: SEARCH_BY.includes(field('search_by')) ? field('search_by') : 'any',
      query,
      mode: PLAY_MODES.includes(field('mode')) ? field('mode') : 'all',
    };
  } else {
    return null;
  }
  favorite.name = field('name') || defaultName(favorite);
  // What identifies the media: a favorite whose target changed in the
  // configuration is no longer the one playing.
  favorite.signature = JSON.stringify([
    favorite.kind,
    favorite.url ?? favorite.server,
    favorite.by,
    favorite.query,
  ]);
  return favorite;
}

/** Every configured favorite, in slot order. */
export function favoritesOf(config) {
  return FAVORITE_SLOTS.map((slot) => favoriteOf(config, slot)).filter(Boolean);
}

/**
 * The external_id of the media server a favorite names: the server of that
 * name (accents and case aside), else the only one whose name contains it;
 * with no name, the only server added to Gladys.
 */
export function serverOf(gladys, name, language = 'en') {
  const servers = (gladys.devices ?? []).filter(
    (device) => parseDeviceExternalId(gladys, device.external_id)?.kind === DEVICE_KINDS.SERVER,
  );
  const wanted = normalizeText(name);
  let matches = servers;
  if (wanted) {
    const exact = servers.filter((device) => normalizeText(device.name) === wanted);
    matches = exact.length
      ? exact
      : servers.filter((device) => normalizeText(device.name).includes(wanted));
  }
  if (matches.length === 1) return matches[0].external_id;
  throw new UserError(
    matches.length ? MESSAGES.SEVERAL_SERVERS : MESSAGES.SERVER_NOT_FOUND,
    language,
  );
}

/** True when `current` (RendererManager view `favorite`) is this favorite. */
export function isCurrent(favorite, current) {
  return !!current && current.slot === favorite.slot && current.signature === favorite.signature;
}

/**
 * Play the favorite of `slot` on a renderer. Resolves `{ started, name }`,
 * `started: false` when its server search found nothing. A server search
 * ends within `budgetMs`.
 */
export async function playFavorite(context, renderer, slot, { volume, budgetMs }) {
  requireRenderer(context, renderer);
  const favorite = favoriteOf(context.config(), String(slot ?? ''));
  if (!favorite) {
    throw new UserError(MESSAGES.NO_FAVORITE, languageOf(context));
  }
  logger.info(`Favorite ${favorite.slot} "${favorite.name}" -> ${renderer}`);
  const mark = { slot: favorite.slot, signature: favorite.signature };
  if (favorite.kind === FAVORITE_KINDS.URL) {
    await context.renderers.playUrl(renderer, favorite.url, {
      title: favorite.name,
      volume,
      favorite: mark,
    });
    return { started: true, name: favorite.name };
  }
  const { found } = await playFromServer(context, {
    renderer,
    server: serverOf(context.gladys, favorite.server, languageOf(context)),
    by: favorite.by,
    query: favorite.query,
    mode: favorite.mode,
    volume,
    budgetMs,
    favorite: mark,
  });
  return { started: found, name: favorite.name };
}
