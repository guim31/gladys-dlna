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
import { isHttpUrl, loggableUrl } from './upnp/http.js';
import { PLAY_MODES, languageOf, playFromServer, requireRenderer, volumeOf } from './playback.js';
import { playFavorite } from './favorites.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'scenes' });

export { PLAY_MODES };

// The search must end before the action's timeout_seconds (90 s in the
// manifest), with time left to start the renderer.
export const SEARCH_BUDGET_MS = 75000;

export function createSceneActions(context) {
  return {
    /** Search a server and play the results on a renderer. */
    async play_media(fields) {
      requireRenderer(context, fields.renderer);
      const by = SEARCH_BY.includes(fields.search_by) ? fields.search_by : 'any';
      const mode = PLAY_MODES.includes(fields.mode) ? fields.mode : 'all';
      const query = String(fields.query ?? '').trim();
      logger.info(`Scene action play_media <- ${by} "${query}" (${mode})`);
      return playFromServer(context, {
        renderer: fields.renderer,
        server: fields.server,
        by,
        query,
        mode,
        volume: volumeOf(fields.volume),
        budgetMs: SEARCH_BUDGET_MS,
      });
    },

    /** Play a URL (web radio, sound file) on a renderer. */
    async play_url(fields) {
      requireRenderer(context, fields.renderer);
      const url = String(fields.url ?? '').trim();
      if (!isHttpUrl(url)) {
        throw new UserError(MESSAGES.URL_SCHEME, languageOf(context));
      }
      logger.info(`Scene action play_url <- ${loggableUrl(url)}`);
      await context.renderers.playUrl(fields.renderer, url, {
        // Empty: the station name of a web radio, else the URL.
        title: String(fields.title ?? '').trim() || undefined,
        volume: volumeOf(fields.volume),
      });
      return { started: true };
    },

    /** Play one of the favorites of the configuration on a renderer. */
    async play_favorite(fields) {
      logger.info(`Scene action play_favorite <- ${fields.favorite}`);
      return playFavorite(context, fields.renderer, fields.favorite, {
        volume: volumeOf(fields.volume),
        budgetMs: SEARCH_BUDGET_MS,
      });
    },
  };
}
