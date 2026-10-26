// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse and
// search the media servers added to Gladys, play on a renderer, the play
// queue, and the bytes of the artworks. Read on demand, never stored.
//
// A DLNA renderer has no catalog of its own: the catalog is the
// ContentDirectory of the media servers (minidlna, Gerbera, Jellyfin, a
// NAS…). The panel opens on a renderer, so its root lists the servers (the
// content of the server directly when there is only one).
//
// MediaItem ids: `dlna:<c|i>:<server platform id>:<object id>:<title>`, the
// object id and the title URI-encoded. ContentDirectory object ids are not
// stable everywhere (minidlna numbers its objects again on a rebuild of its
// database): a scene `music.play-media` keeps an id for months, so the title
// travels with it and an object whose title changed is looked up again by
// title (src/catalog.js `resolve`).
//
// The queue is the integration's (src/poller.js): UPnP has none, a renderer
// plays one URI and maybe preloads the next.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  MUSIC_MEDIA_TYPES,
  MUSIC_PLAY_MODES,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { DEVICE_KINDS, parseDeviceExternalId } from './devices/index.js';
import { MAX_QUEUE, titleOfUri } from './poller.js';
import { withServer } from './servers.js';
import { SearchTimeoutError, normalizeText, searchLiteral } from './upnp/server.js';
import { pickArtwork } from './upnp/didl.js';
import { isHttpUrl, loggableUrl } from './upnp/http.js';
import { UpnpError } from './upnp/soap.js';
import { MAX_ARTWORK_DOWNLOAD, prepareArtwork, readLimited } from './artwork-resize.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'catalog' });

// Bounds of the core (capabilities/music.md, section 4.2).
export const MAX_ID = 512;
const MAX_TEXT = 200;
// The title kept in an id, in characters.
const HINT_LENGTH = 80;

export const KIND = { CONTAINER: 'c', ITEM: 'i' };
const PREFIX = 'dlna';

// The core waits 10 s for a music command: each operation stops before.
export const BUDGET_MS = { BROWSE: 8000, SEARCH: 8000, RESOLVE: 5000 };
const ARTWORK_TIMEOUT_MS = 10_000;

// UPnP ContentDirectory "no such object" (701) and "no such container" (710).
const GONE_CODES = ['701', '710'];

const { TRACK, ALBUM, ARTIST, PLAYLIST, RADIO, FOLDER } = MUSIC_MEDIA_TYPES;

// The upnp:class a search of each type looks for.
const SEARCH_CLASSES = {
  [TRACK]: 'object.item.audioItem',
  [ALBUM]: 'object.container.album.musicAlbum',
  [ARTIST]: 'object.container.person.musicArtist',
  [PLAYLIST]: 'object.container.playlistContainer',
  [RADIO]: 'object.item.audioItem.audioBroadcast',
  [FOLDER]: 'object.container.storageFolder',
};
// A search without a type: albums, artists and playlists first, then tracks.
const DEFAULT_SEARCH = [ALBUM, ARTIST, PLAYLIST, TRACK];

const hint = (title) =>
  Array.from(String(title ?? ''))
    .slice(0, HINT_LENGTH)
    .join('');

/** The MediaItem id of a server object, or null when it cannot fit. */
export function mediaId(kind, platformId, objectId, title = '') {
  const base = `${PREFIX}:${kind}:${platformId}:${encodeURIComponent(objectId)}:`;
  let text = hint(title);
  for (;;) {
    const id = base + encodeURIComponent(text);
    if (id.length <= MAX_ID) return id;
    if (text === '') return null;
    text = Array.from(text)
      .slice(0, Math.floor(Array.from(text).length / 2))
      .join('');
  }
}

/** `{ kind, platformId, objectId, title }` of one of our ids, or null. */
export function parseMediaId(id) {
  const parts = String(id ?? '').split(':');
  if (parts.length !== 5 || parts[0] !== PREFIX || !Object.values(KIND).includes(parts[1])) {
    return null;
  }
  if (!parts[2] || !parts[3]) return null;
  try {
    return {
      kind: parts[1],
      platformId: parts[2],
      objectId: decodeURIComponent(parts[3]),
      title: decodeURIComponent(parts[4]),
    };
  } catch {
    return null;
  }
}

/** What a ContentDirectory object is in the panel: type, browsable, playable. */
export function describeObject(object) {
  const upnpClass = String(object.upnpClass ?? '').toLowerCase();
  if (object.kind === 'container') {
    if (upnpClass.startsWith('object.container.album.musicalbum')) {
      return { type: ALBUM, browsable: true, playable: true };
    }
    if (upnpClass.startsWith('object.container.person')) {
      return { type: ARTIST, browsable: true, playable: true };
    }
    if (upnpClass.startsWith('object.container.playlistcontainer')) {
      return { type: PLAYLIST, browsable: true, playable: true };
    }
    // A plain folder is browsed, never played whole (the spec's `folder`).
    return { type: FOLDER, browsable: true, playable: false };
  }
  const playable = object.resources.length > 0 && !upnpClass.startsWith('object.item.imageitem');
  const radio = /^object\.item\.(audioitem|videoitem)\.(audio|video)broadcast/.test(upnpClass);
  return { type: radio ? RADIO : TRACK, browsable: false, playable };
}

const clip = (value) => {
  const text = String(value ?? '').trim();
  return text ? Array.from(text).slice(0, MAX_TEXT).join('') : '';
};

/**
 * The MediaItem of a ContentDirectory object. An object whose id cannot fit
 * stays in the list as a neutral row (neither browsable nor playable): the
 * panel asks the next page at `offset = rows received`, a row left out
 * would shift every page after it.
 */
export function toMediaItem(gladys, platformId, object) {
  const { type, browsable, playable } = describeObject(object);
  const kind = object.kind === 'container' ? KIND.CONTAINER : KIND.ITEM;
  const id = mediaId(kind, platformId, object.id, object.title);
  const item = {
    id:
      id ??
      `${PREFIX}:x:${createHash('sha1').update(`${platformId}:${object.id}`).digest('hex').slice(0, 20)}`,
    type,
    title: clip(object.title) || clip(object.id) || '—',
    browsable: id !== null && browsable,
    playable: id !== null && playable,
  };
  const subtitle = clip(object.artist) || (kind === KIND.ITEM ? clip(object.album) : '');
  if (subtitle) item.subtitle = subtitle;
  const duration = object.resources?.[0]?.duration;
  item.duration = kind === KIND.ITEM && Number.isFinite(duration) ? duration : null;
  const art = pickArtwork(object, 'list');
  if (art) item.artwork_key = gladys.artworkKey(art);
  return item;
}

/** A row of the queue (a track of src/poller.js). */
export function queueItem(gladys, track, index) {
  const uri = String(track.uri ?? '');
  const item = {
    id: track.mediaId || (uri && uri.length <= MAX_ID ? uri : `${PREFIX}:q:${index}`),
    type: TRACK,
    title: clip(track.title) || clip(titleOfUri(uri)) || '—',
    duration: Number.isFinite(track.duration) ? track.duration : null,
    browsable: false,
    playable: true,
  };
  const subtitle = clip(track.artist) || clip(track.album);
  if (subtitle) item.subtitle = subtitle;
  const art = track.listArtUri || track.albumArtUri;
  if (art && isHttpUrl(art)) item.artwork_key = gladys.artworkKey(art);
  return item;
}

/** Track order of an album: by track number when the server gives one. */
function albumOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.trackNumber ?? Infinity) - (b.item.trackNumber ?? Infinity) || a.index - b.index,
    )
    .map(({ item }) => item);
}

const matchesQuery = (object, needle) =>
  [object.title, object.artist, object.album].some((field) =>
    normalizeText(field).includes(needle),
  );

const isGone = (err) => err instanceof UpnpError && GONE_CODES.includes(err.code);

export function createCatalog(context) {
  const { gladys, registry, renderers } = context;
  const language = () => context.language?.() ?? 'en';
  const fail = (message, cause) => new UserError(message, language(), cause);

  /** The media servers added to Gladys, by name. */
  function servers() {
    return (gladys.devices ?? [])
      .map((device) => ({ device, parsed: parseDeviceExternalId(gladys, device.external_id) }))
      .filter(({ parsed }) => parsed?.kind === DEVICE_KINDS.SERVER)
      .map(({ device, parsed }) => ({
        externalId: device.external_id,
        platformId: parsed.platformId,
        name: device.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Run `work(client)` on a server added to Gladys, within `budgetMs`. */
  async function onServer(platformId, budgetMs, work) {
    const server = servers().find((candidate) => candidate.platformId === platformId);
    if (!server) throw fail(MESSAGES.SERVER_GONE);
    try {
      return await withServer(context, server.externalId, (client) =>
        work(client.withDeadline(budgetMs)),
      );
    } catch (err) {
      if (err instanceof SearchTimeoutError) throw fail(MESSAGES.SEARCH_TIMEOUT, err);
      if (isGone(err)) throw fail(MESSAGES.MEDIA_GONE, err);
      throw err;
    }
  }

  function requireRenderer(device) {
    const parsed = parseDeviceExternalId(gladys, device?.external_id);
    if (parsed?.kind !== DEVICE_KINDS.RENDERER) throw fail(MESSAGES.PICK_RENDERER);
    return device.external_id;
  }

  async function browseContainer(platformId, objectId, offset, limit) {
    const page = await onServer(platformId, BUDGET_MS.BROWSE, (server) =>
      server.browse(objectId, { start: offset, count: limit }),
    );
    const objects = page.objects.slice(0, limit);
    const reached = offset + objects.length;
    // TotalMatches 0 means "unknown" for some servers (minidlna on its
    // root): one more row is announced while pages come back full.
    const total =
      page.total > 0 ? Math.max(page.total, reached) : reached + (objects.length >= limit ? 1 : 0);
    return { items: objects.map((object) => toMediaItem(gladys, platformId, object)), total };
  }

  /** onMusicBrowse. */
  async function browse(device, { parentId, offset = 0, limit = 50 } = {}) {
    if (parentId === null || parentId === undefined || parentId === '') {
      const list = servers();
      if (list.length === 0) throw fail(MESSAGES.NO_SERVER);
      if (list.length === 1) return browseContainer(list[0].platformId, '0', offset, limit);
      return {
        items: list.slice(offset, offset + limit).map((server) => ({
          id: mediaId(KIND.CONTAINER, server.platformId, '0', server.name),
          type: FOLDER,
          title: clip(server.name) || '—',
          browsable: true,
          playable: false,
        })),
        total: list.length,
      };
    }
    const ref = parseMediaId(parentId);
    if (!ref || ref.kind !== KIND.CONTAINER) throw fail(MESSAGES.UNKNOWN_MEDIA);
    return browseContainer(ref.platformId, ref.objectId, offset, limit);
  }

  /** The SearchCriteria of a search of `type`, or null when the server cannot. */
  async function criteriaFor(server, type, query) {
    if (!(await server.canSearch('upnp:class')) || !(await server.canSearch('dc:title'))) {
      return null;
    }
    const literal = searchLiteral(query);
    const fields = ['dc:title'];
    if (type === TRACK || type === ALBUM) {
      for (const property of ['upnp:artist', 'upnp:album']) {
        if (property === 'upnp:album' && type === ALBUM) continue;
        if (await server.canSearch(property)) fields.push(property);
      }
    }
    const clause = fields.map((field) => `${field} contains ${literal}`).join(' or ');
    return `upnp:class derivedfrom "${SEARCH_CLASSES[type]}" and (${clause})`;
  }

  async function searchServer(platformId, query, type, limit) {
    const needle = normalizeText(query);
    const types = type ? [type] : DEFAULT_SEARCH;
    return onServer(platformId, BUDGET_MS.SEARCH, async (server) => {
      const found = [];
      for (const wanted of types) {
        const criteria = await criteriaFor(server, wanted, query);
        if (criteria === null) {
          // No Search: one bounded crawl for every type at once.
          await server.crawl((object) => {
            const kind = describeObject(object).type;
            if (types.includes(kind) && matchesQuery(object, needle)) found.push(object);
            return found.length >= limit * types.length;
          });
          break;
        }
        try {
          const { items, containers } = await server.search('0', criteria, {
            max: limit,
            pageSize: limit,
          });
          found.push(
            ...[...containers, ...items].filter(
              (object) => describeObject(object).type === wanted && matchesQuery(object, needle),
            ),
          );
        } catch (err) {
          // One type refused (a criteria the server does not take): the next.
          if (err instanceof SearchTimeoutError) throw err;
          logger.debug(`Search of ${wanted} refused: ${err.message}`);
        }
      }
      return found;
    });
  }

  /** onMusicSearch: every server added to Gladys, its results deduplicated. */
  async function search(device, { query, type = null, limit = 20 } = {}) {
    const list = servers();
    if (list.length === 0) throw fail(MESSAGES.NO_SERVER);
    const results = await Promise.allSettled(
      list.map((server) => searchServer(server.platformId, query, type, limit)),
    );
    if (results.every((result) => result.status === 'rejected')) throw results[0].reason;
    const items = [];
    const seen = new Set();
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.debug(`Search on ${list[index].name} failed: ${result.reason?.message}`);
        return;
      }
      for (const object of result.value) {
        // A server lists an album in several views (by album, by artist, by
        // genre), a track by reference: one row each.
        const item = toMediaItem(gladys, list[index].platformId, object);
        const key =
          object.kind === 'item'
            ? `${index}|${object.resources[0]?.uri ?? object.id}`
            : `${index}|${item.type}|${normalizeText(item.title)}|${normalizeText(item.subtitle)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    });
    return { items: items.slice(0, limit) };
  }

  // A server shows one album in several views (an album, the folder on
  // disk): the panel only plays containers that are not plain folders.
  const preferred = (candidates) =>
    candidates.find((object) => describeObject(object).type !== FOLDER) ?? candidates[0] ?? null;

  /** The object again from its title, when its id no longer designates it. */
  async function findAgain(server, ref) {
    const title = normalizeText(ref.title);
    if (!title) return null;
    const kind = ref.kind === KIND.CONTAINER ? 'container' : 'item';
    const same = (object) =>
      object.kind === kind && normalizeText(hint(object.title)) === normalizeText(hint(ref.title));
    if ((await server.canSearch('dc:title')) && (await server.canSearch('upnp:class'))) {
      try {
        const { items, containers } = await server.search(
          '0',
          `upnp:class derivedfrom "object.${kind}" and dc:title contains ${searchLiteral(ref.title)}`,
          { max: 50, pageSize: 50 },
        );
        // The server searched its whole library: no need to crawl it.
        return preferred([...containers, ...items].filter(same));
      } catch (err) {
        if (err instanceof SearchTimeoutError) throw err;
        // Declared but refused: crawl below.
      }
    }
    const candidates = [];
    await server.crawl((object) => {
      if (same(object)) candidates.push(object);
      return candidates.length >= 10;
    });
    return preferred(candidates);
  }

  /** The playable items of one of our ids, each with its own id. */
  async function resolve(ref) {
    return onServer(ref.platformId, BUDGET_MS.RESOLVE, async (server) => {
      let object = null;
      try {
        ({
          objects: [object = null],
        } = await server.browse(ref.objectId, { metadata: true }));
      } catch (err) {
        if (!isGone(err)) throw err;
      }
      const renamed =
        object &&
        ref.objectId !== '0' &&
        normalizeText(hint(object.title)) !== normalizeText(hint(ref.title));
      if (!object || renamed) {
        logger.debug(`Object ${ref.objectId} moved: looked up by its title`);
        object = await findAgain(server, ref);
      }
      if (!object) throw fail(MESSAGES.MEDIA_GONE);
      let items;
      if (object.kind === 'item') {
        items = [object];
      } else {
        items = await server.collectItems(object.id, { limit: MAX_QUEUE });
        if (describeObject(object).type === ALBUM) items = albumOrder(items);
      }
      return items.map((item) => ({
        ...item,
        mediaId: mediaId(KIND.ITEM, ref.platformId, item.id, item.title),
      }));
    });
  }

  /** onMusicPlay (and the `music.play-media` scene action). */
  async function play(device, media, mode = MUSIC_PLAY_MODES.REPLACE) {
    const renderer = requireRenderer(device);
    const ref = parseMediaId(media?.id);
    let items;
    if (ref) {
      items = await resolve(ref);
    } else if (isHttpUrl(media?.id)) {
      // A row of the queue: its URL.
      items = [
        {
          title: '',
          artist: '',
          album: '',
          resources: [{ uri: media.id, protocolInfo: '', duration: null }],
        },
      ];
    } else {
      throw fail(MESSAGES.UNKNOWN_MEDIA);
    }
    logger.info(`Play (${mode}) ${items.length} track(s) on ${renderer}`);
    if (mode === MUSIC_PLAY_MODES.NEXT || mode === MUSIC_PLAY_MODES.APPEND) {
      await renderers.enqueue(renderer, items, mode);
    } else {
      await renderers.playItems(renderer, items);
    }
  }

  /** onMusicQueueGet. */
  async function queueGet(device, { offset = 0, limit = 50 } = {}) {
    const page = renderers.queuePage(requireRenderer(device), { offset, limit });
    return {
      items: page.tracks.map((track, index) => queueItem(gladys, track, offset + index)),
      currentIndex: page.currentIndex,
      total: page.total,
    };
  }

  /** onMusicQueuePlay. */
  async function queuePlay(device, index) {
    await renderers.playQueueIndex(requireRenderer(device), Number(index));
  }

  /**
   * onMusicGetArtwork: the image an albumArtURI points to, made small enough
   * for the core (a media server often serves the cover as it is on disk,
   * several megabytes; artwork-resize.js).
   */
  async function artwork(key) {
    const url = gladys.artworkUrls?.get(key);
    if (url === undefined) throw new Error(`Unknown artwork ${key}`);
    if (!isHttpUrl(url)) throw new Error(`Artwork ${key}: not an http(s) URL`);
    const fetchImpl = registry.fetchImpl ?? globalThis.fetch;
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(ARTWORK_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Artwork ${loggableUrl(url)}: ${err.message}`, { cause: err });
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(`Artwork ${loggableUrl(url)}: HTTP ${response.status}`);
    }
    try {
      if (Number(response.headers?.get?.('content-length')) > MAX_ARTWORK_DOWNLOAD) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`Image larger than ${MAX_ARTWORK_DOWNLOAD / 1024 / 1024} MB`);
      }
      const image = await prepareArtwork(await readLimited(response.body, MAX_ARTWORK_DOWNLOAD));
      return image.toString('base64');
    } catch (err) {
      throw new Error(`Artwork ${loggableUrl(url)}: ${err.message}`, { cause: err });
    }
  }

  return { browse, search, play, queueGet, queuePlay, artwork, servers };
}
