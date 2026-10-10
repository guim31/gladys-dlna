// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `fields` arrive resolved by the core (scene variables substituted, defaults
// applied, validated); a `"source": "devices"` field is the chosen device
// external_id. A handler resolves the declared `outputs`; throwing fails this
// action only, the scene goes on.
//
// The scene triggers (playback started / paused / stopped) are fired by the
// renderer poller when it sees the transport state change: see src/poller.js.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SEARCH_BY } from './upnp/server.js';
import { isHttpUrl } from './upnp/http.js';
import { isRenderer, withServer } from './servers.js';

const logger = createLogger({ name: 'scenes' });

export const PLAY_MODES = ['all', 'shuffle', 'first'];

// The search must end before the action's timeout_seconds (90 s in the
// manifest), with time left to start the renderer.
export const SEARCH_BUDGET_MS = 75000;

function requireRenderer(gladys, externalId) {
  if (!isRenderer(gladys, externalId)) {
    throw new Error('Pick a DLNA renderer');
  }
}

/** A volume field: a number from 0 to 100, or undefined when left empty. */
function volumeOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const volume = Number(value);
  if (!Number.isFinite(volume)) return undefined;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

export function createSceneActions(context) {
  const { gladys, renderers } = context;
  return {
    /** Search a server and play the results on a renderer. */
    async play_media(fields) {
      requireRenderer(gladys, fields.renderer);
      const by = SEARCH_BY.includes(fields.search_by) ? fields.search_by : 'any';
      const mode = PLAY_MODES.includes(fields.mode) ? fields.mode : 'all';
      const query = String(fields.query ?? '').trim();
      logger.info(`Scene action play_media <- ${by} "${query}" (${mode})`);
      const found = await withServer(context, fields.server, (server) =>
        server.withDeadline(SEARCH_BUDGET_MS).findMedia({ by, query }),
      );
      // "first" keeps the server order (album order for an album or a folder).
      const items = mode === 'first' ? found.slice(0, 1) : found;
      if (items.length === 0) {
        logger.info(`play_media: nothing found for ${by} "${query}"`);
        return { found: false, count: 0, title: '' };
      }
      const volume = volumeOf(fields.volume);
      if (volume !== undefined) {
        await renderers.setVolume(fields.renderer, volume);
      }
      const { track, count } = await renderers.playItems(fields.renderer, items, {
        shuffled: mode === 'shuffle',
      });
      return { found: true, count, title: track.title || '' };
    },

    /** Play a URL (web radio, sound file) on a renderer. */
    async play_url(fields) {
      requireRenderer(gladys, fields.renderer);
      const url = String(fields.url ?? '').trim();
      if (!isHttpUrl(url)) {
        throw new Error('The URL must start with http:// or https://');
      }
      logger.info(`Scene action play_url <- ${url}`);
      await renderers.playUrl(fields.renderer, url, {
        title: String(fields.title ?? '').trim() || undefined,
        volume: volumeOf(fields.volume),
      });
      return { started: true };
    },
  };
}
