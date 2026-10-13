// -----------------------------------------------------------------------------
// What the scene actions, the favorites and their widget share: check the
// renderer picked, read a volume field, search a server and play the results.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SearchTimeoutError } from './upnp/server.js';
import { isRenderer, withServer } from './servers.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'playback' });

export const PLAY_MODES = ['all', 'shuffle', 'first'];

/** The language of the errors thrown to the core (see i18n.js). */
export const languageOf = (context) => context.language?.() ?? 'en';

export function requireRenderer(context, externalId, message = MESSAGES.PICK_RENDERER) {
  if (!isRenderer(context.gladys, externalId)) {
    throw new UserError(message, languageOf(context));
  }
}

/** A volume field: a number from 0 to 100, or undefined when left empty. */
export function volumeOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const volume = Number(value);
  if (!Number.isFinite(volume)) return undefined;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

/**
 * Search a server and play what it found on a renderer, as a queue.
 * Resolves `{ found, count, title }`; `found: false` when nothing matched.
 * The search ends within `budgetMs`, on a UserError.
 */
export async function playFromServer(
  context,
  { renderer, server, by, query, mode, volume, budgetMs, favorite },
) {
  const { renderers } = context;
  let found;
  try {
    found = await withServer(context, server, (client) =>
      client.withDeadline(budgetMs).findMedia({ by, query }),
    );
  } catch (err) {
    if (err instanceof SearchTimeoutError) {
      throw new UserError(MESSAGES.SEARCH_TIMEOUT, languageOf(context), err);
    }
    throw err;
  }
  // "first" keeps the server order (album order for an album or a folder).
  const items = mode === 'first' ? found.slice(0, 1) : found;
  if (items.length === 0) {
    logger.debug(`Nothing found for ${by} "${query}"`);
    return { found: false, count: 0, title: '' };
  }
  if (volume !== undefined) {
    await renderers.setVolume(renderer, volume);
  }
  const { track, count } = await renderers.playItems(renderer, items, {
    shuffled: mode === 'shuffle',
    favorite,
  });
  return { found: true, count, title: track.title || '' };
}
