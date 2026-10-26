// -----------------------------------------------------------------------------
// Renderer state: polling, commands and the play queue.
//
// Why polling: UPnP eventing (GENA) needs the renderer to call back an HTTP
// server of the subscriber, and the integration container has no inbound port
// (the core publishes none for the main container, by design). So the
// container polls GetTransportInfo / GetPositionInfo / GetVolume / GetMute
// itself, at an adaptive pace the core scheduler cannot express (it only
// knows fixed paces): every few seconds while playing, slower when idle, once
// a minute when the renderer is off.
//
// Why a queue: a DLNA renderer plays one URI at a time. To play an album or a
// folder, the integration hands the tracks over one by one: the next one is
// preloaded with SetNextAVTransportURI when the renderer has it (gapless),
// else started when the current one ends. The queue is the integration's, so
// are its shuffle and repeat modes (UPnP has no standard queue: the play mode
// of a renderer applies to its own playlist, which Gladys never fills).
//
// Gladys 5.3: what plays is published through publishNowPlaying (playback
// state, title, artist, album, artwork, duration, position, volume, mute,
// shuffle, repeat), which keeps only the changes; the 1.x "now playing" text
// stays a text feature, published by the StatePublisher.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_TRANSPORTS,
  MUSIC_PLAY_MODES,
  MUSIC_REPEAT_MODE,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { DEVICE_KINDS, PARAMS, paramOf, parseDeviceExternalId } from './devices/index.js';
import {
  MAX_SECONDS,
  NOTHING_PLAYING,
  PLAYBACK_STATE,
  RENDERER_FEATURES,
} from './devices/renderer.js';
import { PLAYBACK } from './upnp/renderer.js';
import { UpnpError } from './upnp/soap.js';
import { buildMetadata, mimeOf, pickArtwork, pickResource } from './upnp/didl.js';
import { COMMANDS, toUserError } from './errors.js';
import { streamTitleOf } from './upnp/icy.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'renderers' });

export const POLL_INTERVALS_MS = {
  QUEUE: 3000, // playing a queue: the end of a track must be seen quickly
  PLAYING: 5000,
  IDLE: 15000,
  UNREACHABLE: 60000,
  AFTER_COMMAND: 800, // the time a renderer takes to change state
};

export const SCENE_TRIGGERS = {
  STARTED: 'playback_started',
  PAUSED: 'playback_paused',
  STOPPED: 'playback_stopped',
};

const TRIGGER_BY_PLAYBACK = {
  [PLAYBACK.PLAYING]: SCENE_TRIGGERS.STARTED,
  [PLAYBACK.PAUSED]: SCENE_TRIGGERS.PAUSED,
  [PLAYBACK.STOPPED]: SCENE_TRIGGERS.STOPPED,
};

// A queue never holds more tracks than this (memory, and a sane scene).
export const MAX_QUEUE = 200;
// A track that stopped this close to its end ended by itself.
const END_TOLERANCE_S = 15;
// Right after a track is started, the renderer may still describe the
// previous media: it is not "something else playing" yet.
const START_GRACE_MS = 10000;
const NOW_PLAYING_MAX = 200;
export const VOLUME_STEP = 5;
// A position read twice this far apart while playing has not moved: the
// renderer does not report it (or freezes it), it is not published again.
const FROZEN_POSITION_MS = 2000;

const COMMAND_OF_FEATURE = {
  [RENDERER_FEATURES.PLAY]: COMMANDS.PLAY,
  [RENDERER_FEATURES.PAUSE]: COMMANDS.PAUSE,
  [RENDERER_FEATURES.STOP]: COMMANDS.STOP,
  [RENDERER_FEATURES.NEXT]: COMMANDS.NEXT,
  [RENDERER_FEATURES.PREVIOUS]: COMMANDS.PREVIOUS,
};

/** "Artist — Title", the title alone, or the placeholder. */
export function formatNowPlaying({ title, artist } = {}) {
  const text = title && artist ? `${artist} — ${title}` : title || '';
  if (!text) return NOTHING_PLAYING;
  return text.length > NOW_PLAYING_MAX ? `${text.slice(0, NOW_PLAYING_MAX - 1)}…` : text;
}

/** A queue track from a ContentDirectory item, or null when nothing plays. */
export function trackOf(item, sink) {
  const res = pickResource(item, sink);
  if (!res) return null;
  return {
    uri: res.uri,
    // The catalog id of the item (src/catalog.js), when it came from there.
    mediaId: item.mediaId ?? null,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration: res.duration,
    albumArtUri: pickArtwork(item, 'player'),
    listArtUri: pickArtwork(item, 'list'),
    metadata: buildMetadata({
      url: res.uri,
      title: item.title,
      artist: item.artist,
      album: item.album,
      albumArtUri: item.albumArtUri,
      duration: res.duration,
      mime: mimeOf(res.protocolInfo),
      protocolInfo: res.protocolInfo,
      upnpClass: item.upnpClass,
    }),
  };
}

/** Fisher–Yates, in place. */
export function shuffle(list, random = Math.random) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function isTrack(status, track) {
  if (!track) return false;
  if (status.uri && status.uri === track.uri) return true;
  // Some renderers play through a proxy and report another URI.
  return !!status.title && status.title === track.title;
}

/**
 * The index of the queue track that follows the current one when it ends:
 * the same one in repeat-one, the first one after the last in repeat-all,
 * -1 at the end of the queue.
 */
export function followingIndex(queue, repeat) {
  if (repeat === MUSIC_REPEAT_MODE.ONE) return queue.index;
  if (queue.index + 1 < queue.tracks.length) return queue.index + 1;
  return repeat === MUSIC_REPEAT_MODE.ALL ? 0 : -1;
}

/** The playback_state of Gladys 5.3 for a renderer status, null when unknown. */
export function playbackStateOf(status) {
  if (status.transportState === 'TRANSITIONING') return PLAYBACK_STATE.BUFFERING;
  switch (status.playback) {
    case PLAYBACK.PLAYING:
      return PLAYBACK_STATE.PLAYING;
    case PLAYBACK.PAUSED:
      return PLAYBACK_STATE.PAUSED;
    case PLAYBACK.STOPPED:
      return PLAYBACK_STATE.IDLE;
    default:
      return null;
  }
}

/** A title for a media the renderer describes by its URL only: its file name. */
export function titleOfUri(uri) {
  try {
    const url = new URL(uri);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    return name.replace(/\.[a-z0-9]{2,5}$/i, '') || url.host;
  } catch {
    return '';
  }
}

const seconds = (value) =>
  Number.isFinite(value) ? Math.min(MAX_SECONDS, Math.max(0, Math.round(value))) : 0;

// What a Gladys 5.3 snapshot holds when nothing is loaded: the texts are
// cleared explicitly (an absent key means "unchanged").
const NOTHING_LOADED = {
  title: '',
  artist: '',
  album: '',
  artwork_url: null,
  duration: 0,
  position: 0,
};

export class RendererManager {
  constructor({
    gladys,
    registry,
    publisher,
    onDisplayChange = () => {},
    onUnreachable = () => {},
    timers = globalThis,
    now = () => Date.now(),
    random = Math.random,
    // The language of the configuration: the core relays the error text of
    // a command without telling the user's language.
    language = () => 'en',
    // The name of a web radio played without a title (ICY headers).
    streamTitle = (url) => streamTitleOf(url, { fetchImpl: registry?.fetchImpl }),
  }) {
    this.gladys = gladys;
    this.registry = registry;
    this.publisher = publisher;
    this.onDisplayChange = onDisplayChange;
    this.onUnreachable = onUnreachable;
    this.timers = timers;
    this.now = now;
    this.random = random;
    this.language = language;
    this.streamTitle = streamTitle;
    this.entries = new Map();
    this.active = true;
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Follow exactly the renderers created in Gladys. */
  sync(devices = []) {
    this.active = true;
    const wanted = new Map();
    for (const device of devices) {
      const parsed = parseDeviceExternalId(this.gladys, device.external_id);
      if (parsed?.kind === DEVICE_KINDS.RENDERER) {
        wanted.set(device.external_id, { device, platformId: parsed.platformId });
      }
    }
    for (const [externalId, { device, platformId }] of wanted) {
      const entry = this.entries.get(externalId);
      if (entry) {
        entry.device = device;
        // Resume after stopAll (a lost connection).
        if (!entry.timer && !entry.running) this.schedule(entry, 0);
      } else {
        this.entries.set(externalId, {
          externalId,
          platformId,
          device,
          status: null,
          playback: null,
          reachable: null,
          queue: null,
          lastPlaying: null,
          timer: null,
          running: null,
          soon: false,
          playToken: 0,
          loadedUri: null,
          // The URL played by Gladys and the title it was given, shown when
          // the renderer describes it by its bare URL (or not at all).
          media: null,
          // The favorite Gladys started, while it is what the renderer holds.
          favorite: null,
          // Gladys refuses the states: logged once until it accepts them.
          publishFailing: false,
          // Modes of the queue of the integration (Gladys 5.3 shuffle and
          // repeat), kept from one queue to the next like a player app does.
          shuffle: false,
          repeat: MUSIC_REPEAT_MODE.OFF,
          // The last position read while playing, to tell a frozen one.
          sample: null,
        });
        this.schedule(this.entries.get(externalId), 0);
      }
    }
    for (const [externalId, entry] of this.entries) {
      if (!wanted.has(externalId)) {
        this.timers.clearTimeout(entry.timer);
        this.entries.delete(externalId);
      }
    }
  }

  stopAll() {
    this.active = false;
    for (const entry of this.entries.values()) {
      this.timers.clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  entryOf(externalId) {
    const entry = this.entries.get(externalId);
    if (!entry) {
      throw new UserError(MESSAGES.UNKNOWN_RENDERER, this.language());
    }
    return entry;
  }

  async rendererOf(entry) {
    const info = await this.registry.locate(
      DEVICE_KINDS.RENDERER,
      entry.platformId,
      paramOf(entry.device, PARAMS.LOCATION),
    );
    return this.registry.clientOf(info);
  }

  hasFeature(entry, key) {
    const id = `${entry.externalId}:${key}`;
    return (entry.device.features ?? []).some((feature) => feature.external_id === id);
  }

  // --- Polling ----------------------------------------------------------------

  nextDelay(entry) {
    if (entry.soon) {
      entry.soon = false;
      return POLL_INTERVALS_MS.AFTER_COMMAND;
    }
    if (entry.reachable === false) return POLL_INTERVALS_MS.UNREACHABLE;
    if (entry.playback === PLAYBACK.PLAYING) {
      return entry.queue ? POLL_INTERVALS_MS.QUEUE : POLL_INTERVALS_MS.PLAYING;
    }
    return POLL_INTERVALS_MS.IDLE;
  }

  schedule(entry, delay) {
    this.timers.clearTimeout(entry.timer);
    entry.timer = null;
    if (!this.active || this.entries.get(entry.externalId) !== entry) return;
    entry.timer = this.timers.setTimeout(() => {
      this.refresh(entry.externalId).catch((err) => logger.debug(`Refresh failed: ${err.message}`));
    }, delay);
    entry.timer?.unref?.();
  }

  /** Poll soon: right after a command, the renderer changes state. */
  refreshSoon(entry) {
    entry.soon = true;
    if (!entry.running) this.schedule(entry, POLL_INTERVALS_MS.AFTER_COMMAND);
  }

  /** Poll one renderer now (concurrent calls share the same poll). */
  refresh(externalId) {
    const entry = this.entries.get(externalId);
    if (!entry) return Promise.resolve(null);
    if (!entry.running) {
      entry.running = this.poll(entry).finally(() => {
        entry.running = null;
        this.schedule(entry, this.nextDelay(entry));
      });
    }
    return entry.running;
  }

  /** Forget the published states of a renderer and publish them all again. */
  republish(externalId) {
    this.publisher.forget(externalId);
    this.gladys.forgetPublishedStates?.(externalId);
    const entry = this.entries.get(externalId);
    if (entry) {
      entry.reachable = null; // the transport badge too
    }
    return this.refresh(externalId);
  }

  async poll(entry) {
    let renderer;
    let status;
    try {
      renderer = await this.rendererOf(entry);
      status = await renderer.getStatus();
    } catch (err) {
      await this.markUnreachable(entry, err);
      return null;
    }
    await this.markReachable(entry);
    if (await this.followQueue(entry, status, renderer)) {
      // The next track was just started: the status read before is stale,
      // and the short stop between two tracks is not a "playback stopped".
      entry.soon = true;
      return status;
    }
    this.nameMedia(entry, status);
    if (this.followFavorite(entry, status)) this.onDisplayChange(entry.externalId);
    await this.applyStatus(entry, status);
    return status;
  }

  /** The title Gladys gave a URL, when the renderer only knows the URL. */
  nameMedia(entry, status) {
    const media = entry.media;
    if (!media?.title || !status.uri || status.uri !== media.uri) return;
    if (!status.title || status.title === status.uri) status.title = media.title;
  }

  /**
   * Forget the current favorite once the renderer plays something else: its
   * queue ended or was dropped, or another URL plays (after the start grace).
   * True when it was forgotten.
   */
  followFavorite(entry, status) {
    const favorite = entry.favorite;
    if (!favorite) return false;
    let gone;
    if (favorite.queue) {
      gone = !entry.queue;
    } else {
      const settled = this.now() - favorite.startedAt > START_GRACE_MS;
      gone = settled && !!status.uri && !isTrack(status, favorite);
    }
    if (gone) entry.favorite = null;
    return gone;
  }

  async publishTransport(entry, transport) {
    try {
      await this.gladys.publishTransports([{ external_id: entry.externalId, transport }]);
    } catch (err) {
      logger.debug(`Transport badge not published: ${err.message}`);
    }
  }

  async markReachable(entry) {
    if (entry.reachable === true) return;
    if (entry.reachable === false) {
      logger.info(`${entry.device.name} is reachable again`);
    }
    entry.reachable = true;
    await this.publishTransport(entry, DEVICE_TRANSPORTS.LOCAL);
    this.onDisplayChange(entry.externalId);
  }

  async markUnreachable(entry, err) {
    if (entry.reachable === false) return;
    logger.warn(`${entry.device.name} is unreachable: ${err.message}`);
    entry.reachable = false;
    // The next attempt fetches the description again: the renderer may come
    // back on another port, or another address once a scan relocated it.
    this.registry.forget(DEVICE_KINDS.RENDERER, entry.platformId);
    // Not reachable is not "stopped": no scene trigger now, none on return.
    entry.playback = null;
    entry.lastPlaying = null;
    entry.status = null;
    await this.publishTransport(entry, DEVICE_TRANSPORTS.UNREACHABLE);
    // A renderer gone (switched off, unplugged) holds nothing any more.
    await this.publishNowPlaying(entry, {
      playback_state: PLAYBACK_STATE.IDLE,
      ...NOTHING_LOADED,
    }).catch((error) => logger.debug(`State not published: ${error.message}`));
    this.onDisplayChange(entry.externalId);
    this.onUnreachable(entry.externalId);
  }

  async applyStatus(entry, status) {
    const previous = entry.status;
    // TRANSITIONING (and vendor states) keep the previous logical state.
    const playback = status.playback ?? entry.playback;
    entry.status = { ...status, playback };

    const id = (key) => `${entry.externalId}:${key}`;
    const states = [];
    if (this.hasFeature(entry, RENDERER_FEATURES.NOW_PLAYING)) {
      states.push({
        id: id(RENDERER_FEATURES.NOW_PLAYING),
        value: { text: formatNowPlaying(status) },
      });
    }
    // A refusal repeats on every poll: one line when it starts, one when it
    // ends, the attempts in between in debug.
    try {
      const { count } = await this.publishNowPlaying(entry, this.nowPlayingOf(entry, status));
      const sent = count + (await this.publisher.publish(states));
      // Nothing sent (same states as the last accepted ones) proves nothing.
      if (entry.publishFailing && sent > 0) {
        entry.publishFailing = false;
        logger.info(`States of ${entry.device.name} published again`);
      }
    } catch (err) {
      if (entry.publishFailing) {
        logger.debug(`States of ${entry.device.name} still not published: ${err.message}`);
      } else {
        entry.publishFailing = true;
        logger.warn(`States of ${entry.device.name} not published: ${err.message}`);
      }
    }

    if (entry.playback && playback && playback !== entry.playback) {
      await this.fireTrigger(entry, TRIGGER_BY_PLAYBACK[playback], status);
    }
    entry.playback = playback;

    if (status.playback === PLAYBACK.PLAYING) {
      entry.lastPlaying = { position: status.position, duration: status.duration, at: this.now() };
    } else if (status.playback) {
      entry.lastPlaying = null;
    }

    const shown = ['title', 'artist', 'album', 'playback', 'muted'];
    if (!previous || shown.some((key) => previous[key] !== entry.status[key])) {
      this.onDisplayChange(entry.externalId);
    }
  }

  /**
   * The publishNowPlaying snapshot of a renderer status (Gladys 5.3). What
   * the renderer does not describe comes from what Gladys asked it to play
   * (a queue track, a named URL). Stopped with a media still loaded (most
   * renderers keep it): IDLE, the media stays shown.
   */
  nowPlayingOf(entry, status) {
    const snapshot = { shuffle: entry.shuffle ? 1 : 0, repeat: entry.repeat };
    const state = playbackStateOf(status);
    if (state !== null) snapshot.playback_state = state;
    if (Number.isFinite(status.volume)) snapshot.volume = status.volume;
    if (typeof status.muted === 'boolean') snapshot.mute = status.muted ? 1 : 0;

    const loaded = status.transportState !== 'NO_MEDIA_PRESENT' && !!(status.uri || status.title);
    if (!loaded) {
      entry.sample = null;
      return { ...snapshot, ...NOTHING_LOADED };
    }
    const known = this.knownTrack(entry, status);
    snapshot.title = status.title || known?.title || titleOfUri(status.uri);
    snapshot.artist = status.artist || known?.artist || '';
    snapshot.album = status.album || known?.album || '';
    snapshot.artwork_url = status.albumArtUri || known?.albumArtUri || null;
    snapshot.duration = seconds(status.duration || known?.duration);

    if (status.playback === PLAYBACK.STOPPED) {
      entry.sample = null;
      snapshot.position = 0;
    } else if (Number.isFinite(status.position) && status.position <= MAX_SECONDS) {
      // A renderer that does not report the position (always 0:00:00) or
      // freezes it would make Gladys move the bar back on every poll.
      const key = `${status.uri}|${snapshot.title}`;
      const sample = entry.sample;
      const frozen =
        status.playback === PLAYBACK.PLAYING &&
        sample?.key === key &&
        sample.value === status.position &&
        this.now() - sample.at >= FROZEN_POSITION_MS;
      if (status.playback !== PLAYBACK.PLAYING) {
        // Only a position read while playing can be frozen: after a pause,
        // the first reading again shows where it stopped.
        entry.sample = null;
      } else if (sample?.key !== key || sample.value !== status.position) {
        entry.sample = { key, value: status.position, at: this.now() };
      }
      if (!frozen) snapshot.position = Math.round(status.position);
    }
    return snapshot;
  }

  /** The queue track or the named URL the renderer plays, if Gladys started it. */
  knownTrack(entry, status) {
    const current = entry.queue?.tracks[entry.queue.index];
    if (current && isTrack(status, current)) return current;
    if (entry.media && status.uri && status.uri === entry.media.uri) return entry.media;
    return null;
  }

  async publishNowPlaying(entry, snapshot) {
    if (typeof this.gladys.publishNowPlaying !== 'function') return { count: 0 };
    const result = await this.gladys.publishNowPlaying(entry.externalId, snapshot, {
      // The 1.x id of the playback state (the others follow the SDK default).
      featureExternalIds: {
        playback_state: `${entry.externalId}:${RENDERER_FEATURES.PLAYBACK_STATE}`,
      },
    });
    return { count: result?.count ?? 0 };
  }

  async fireTrigger(entry, key, status) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: entry.externalId,
        renderer: entry.device.name,
        title: status.title || '',
        artist: status.artist || '',
        album: status.album || '',
      });
    } catch (err) {
      logger.debug(`Scene event ${key} not accepted: ${err.message}`);
    }
  }

  // --- Queue ------------------------------------------------------------------

  async startTrack(entry, renderer, track) {
    entry.playToken += 1;
    entry.loadedUri = track.uri;
    // Unknown (not null): an older next URI may still be on the renderer.
    entry.queue.preloaded = undefined;
    entry.queue.startedAt = this.now();
    entry.lastPlaying = null;
    entry.sample = null;
    // Server tracks are plain http, and a Next pressed in Gladys must be
    // acknowledged within 5 s: no playback check here.
    await renderer.playUrl(track.uri, {
      metadata: track.metadata,
      title: track.title,
      verify: false,
    });
    await this.preloadNext(entry, renderer);
  }

  /**
   * Hand the renderer the track that follows (gapless), or take back the one
   * it holds when the queue, shuffle or repeat changed. Never the current
   * track again (repeat-one): the renderer could not tell the two apart, it
   * is started again when it ends.
   */
  async preloadNext(entry, renderer) {
    const queue = entry.queue;
    if (!queue || !renderer.canPreload || queue.noPreload) return;
    const index = followingIndex(queue, entry.repeat);
    // The current URI again (repeat-one, the same track queued next): the
    // renderer could not tell the two apart, it is started at the end.
    const next =
      index === -1 || queue.tracks[index].uri === queue.tracks[queue.index]?.uri
        ? null
        : queue.tracks[index];
    if (next === queue.preloaded) return;
    if (!next) {
      // Best effort: a renderer refusing an empty next URI moves on to the
      // track it holds, and followQueue follows it there.
      await renderer
        .setNextUri('', '')
        .then(() => {
          queue.preloaded = null;
        })
        .catch((err) => logger.debug(`Next URI not cleared: ${err.message}`));
      return;
    }
    try {
      await renderer.setNextUri(next.uri, next.metadata ?? '');
      queue.preloaded = next;
    } catch (err) {
      // Declared but refused: fall back to starting each track ourselves.
      logger.debug(`SetNextAVTransportURI refused: ${err.message}`);
      queue.noPreload = true;
    }
  }

  /**
   * Keep the queue in step with the renderer. Resolves true when a track was
   * started by the integration during this poll.
   */
  async followQueue(entry, status, renderer) {
    const queue = entry.queue;
    if (!queue) return false;
    const current = queue.tracks[queue.index];
    const preloaded = queue.preloaded;

    // The renderer moved to the preloaded track by itself (gapless).
    if (
      preloaded &&
      preloaded !== current &&
      isTrack(status, preloaded) &&
      !isTrack(status, current)
    ) {
      queue.index = queue.tracks.indexOf(preloaded);
      queue.startedAt = this.now();
      queue.preloaded = null;
      entry.sample = null;
      await this.preloadNext(entry, renderer);
      return false;
    }

    // The current track ended: start the next one (or the same one, or the
    // first one, as repeat says), or close the queue.
    if (
      status.playback === PLAYBACK.STOPPED &&
      entry.lastPlaying &&
      this.endedNaturally(entry, current)
    ) {
      const index = followingIndex(queue, entry.repeat);
      if (index === -1) {
        entry.queue = null;
        return false;
      }
      queue.index = index;
      try {
        await this.startTrack(entry, renderer, queue.tracks[index]);
        return true;
      } catch (err) {
        logger.warn(`Next track refused by ${entry.device.name}: ${err.message}`);
        entry.queue = null;
        return false;
      }
    }

    // Something else plays now (another controller, the vendor app).
    const settled = this.now() - (queue.startedAt ?? 0) > START_GRACE_MS;
    if (settled && status.uri && !isTrack(status, current) && !isTrack(status, preloaded)) {
      logger.debug(`${entry.device.name} plays another media: queue dropped`);
      entry.queue = null;
    }
    return false;
  }

  endedNaturally(entry, track) {
    const { position, duration, at } = entry.lastPlaying;
    const length = track?.duration || duration;
    if (!length || !Number.isFinite(position)) return true;
    const elapsed = position + (this.now() - at) / 1000;
    return length - elapsed <= END_TOLERANCE_S;
  }

  /** Next / previous in the queue; past its ends only when repeat is on. */
  async jump(entry, renderer, offset) {
    const queue = entry.queue;
    const length = queue.tracks.length;
    let index = queue.index + offset;
    if (index < 0 || index >= length) {
      if (entry.repeat === MUSIC_REPEAT_MODE.OFF) return false;
      index = (index + length) % length;
    }
    const track = queue.tracks[index];
    if (!track) return false;
    queue.index = index;
    await this.startTrack(entry, renderer, track);
    return true;
  }

  // --- Commands ---------------------------------------------------------------

  /**
   * A refused command, for the user: the raw UPnP error goes to the logs, the
   * error thrown carries a text in the configured language (see errors.js).
   * A 701 reads as "no DLNA media" unless the renderer holds the media Gladys
   * loaded.
   */
  async explainFailure(entry, renderer, err, context = {}) {
    if (!(err instanceof UpnpError)) throw err;
    logger.warn(`${entry.device.name}: ${err.message}`);
    let { mediaLoaded } = context;
    if (mediaLoaded === undefined && err.code === '701') {
      const uri = await renderer.mediaUri();
      mediaLoaded = uri === null ? undefined : !!uri && uri === entry.loadedUri;
    }
    throw toUserError(err, { ...context, mediaLoaded, language: this.language() });
  }

  /**
   * Run a device feature command (onSetValue). With `checkMedia`, resolves
   * `{ noDlnaMedia: true }` when Stop was sent while the renderer held no
   * DLNA media: it answers 200 and may well have done nothing (the device
   * plays Spotify). Opt-in: two more requests, and a device command must be
   * acknowledged within 5 s.
   */
  async command(externalId, featureKey, value, { checkMedia = false, category } = {}) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    // A command ends any follow-up of a playback start (see followStart).
    entry.playToken += 1;
    const failed = (context) => (err) => this.explainFailure(entry, renderer, err, context);
    const asked = failed({ command: COMMAND_OF_FEATURE[featureKey] });
    // A track of the queue is loaded and started by Gladys.
    const jumped = failed({ mediaLoaded: true });
    let outcome = {};
    switch (featureKey) {
      case RENDERER_FEATURES.PLAY:
        await renderer.play().catch(asked);
        break;
      case RENDERER_FEATURES.PAUSE:
        entry.lastPlaying = null;
        await renderer.pause().catch(asked);
        break;
      case RENDERER_FEATURES.STOP: {
        entry.lastPlaying = null;
        const uri = checkMedia ? await renderer.mediaUri() : null;
        await renderer.stop().catch(asked);
        if (uri === '') outcome = { noDlnaMedia: true };
        break;
      }
      case RENDERER_FEATURES.NEXT:
        if (!(entry.queue && (await this.jump(entry, renderer, 1).catch(jumped)))) {
          await renderer.next().catch(asked);
        }
        break;
      case RENDERER_FEATURES.PREVIOUS:
        if (!(entry.queue && (await this.jump(entry, renderer, -1).catch(jumped)))) {
          await renderer.previous().catch(asked);
        }
        break;
      case RENDERER_FEATURES.VOLUME:
        await renderer.setVolume(Number(value)).catch(asked);
        break;
      case RENDERER_FEATURES.MUTE:
        if (category === DEVICE_FEATURE_CATEGORIES.TELEVISION) {
          // The 1.x push button (television key), until the user accepts
          // "Update" in the Discovery tab: it always sends 1, and toggles.
          await renderer
            .getMute()
            .then((muted) => renderer.setMute(!muted))
            .catch(asked);
        } else {
          await renderer.setMute(Number(value) === 1).catch(asked);
        }
        break;
      case RENDERER_FEATURES.PLAYBACK_STATE:
        await this.setPlaybackState(entry, renderer, Number(value), failed);
        break;
      case RENDERER_FEATURES.POSITION:
        if (!renderer.canSeek) {
          throw new UserError(MESSAGES.CANNOT_SEEK, this.language());
        }
        entry.lastPlaying = null;
        await renderer.seek(Math.max(0, Number(value) || 0)).catch(asked);
        break;
      case RENDERER_FEATURES.SHUFFLE:
        await this.setShuffle(entry, renderer, Number(value) === 1);
        return outcome;
      case RENDERER_FEATURES.REPEAT:
        await this.setRepeat(entry, renderer, Number(value));
        return outcome;
      case RENDERER_FEATURES.NOTIFICATION:
        // The core's "play a notification" action sends the URL of a Gladys
        // Plus text-to-speech MP3. The command is acknowledged within 5 s: the
        // playback check (and the http retry of an https URL) goes on after.
        await this.playUrl(externalId, String(value), { title: 'Gladys' });
        return outcome;
      default:
        throw new Error(`Unsupported feature: ${featureKey}`);
    }
    this.refreshSoon(entry);
    return outcome;
  }

  /** Writing the 5.3 playback state: 0 pause, 1 play, 2 stop. */
  async setPlaybackState(entry, renderer, value, failed) {
    switch (value) {
      case PLAYBACK_STATE.PAUSED:
        entry.lastPlaying = null;
        await renderer.pause().catch(failed({ command: COMMANDS.PAUSE }));
        break;
      case PLAYBACK_STATE.PLAYING: {
        // A queue whose renderer lost the media (NO_MEDIA_PRESENT, or an
        // empty URI: upmpdcli unloads it on Stop) starts its current track
        // again.
        const queue = entry.queue;
        const lost =
          entry.status?.transportState === 'NO_MEDIA_PRESENT' || entry.status?.uri === '';
        if (queue && lost) {
          await this.startTrack(entry, renderer, queue.tracks[queue.index]).catch(
            failed({ mediaLoaded: true }),
          );
        } else {
          await renderer.play().catch(failed({ command: COMMANDS.PLAY }));
        }
        break;
      }
      case PLAYBACK_STATE.IDLE:
        entry.lastPlaying = null;
        await renderer.stop().catch(failed({ command: COMMANDS.STOP }));
        break;
      default:
        throw new UserError(MESSAGES.BAD_PLAYBACK_STATE, this.language());
    }
  }

  /** Publish the modes of the queue at once: they are the integration's. */
  async publishModes(entry) {
    await this.publishNowPlaying(entry, {
      shuffle: entry.shuffle ? 1 : 0,
      repeat: entry.repeat,
    }).catch((err) => logger.debug(`Modes not published: ${err.message}`));
  }

  /**
   * Shuffle on: the tracks after the current one are shuffled (their order
   * is kept to come back to it); off: they come back in their order.
   */
  async setShuffle(entry, renderer, on) {
    entry.shuffle = on;
    const queue = entry.queue;
    if (queue) {
      const head = queue.tracks.slice(0, queue.index + 1);
      if (on && !queue.unshuffled) {
        queue.unshuffled = queue.tracks.slice();
        queue.tracks = head.concat(shuffle(queue.tracks.slice(queue.index + 1), this.random));
      } else if (!on && queue.unshuffled) {
        const played = new Set(head);
        queue.tracks = head.concat(queue.unshuffled.filter((track) => !played.has(track)));
        queue.unshuffled = null;
      }
      await this.preloadNext(entry, renderer);
    }
    await this.publishModes(entry);
  }

  async setRepeat(entry, renderer, mode) {
    if (!Object.values(MUSIC_REPEAT_MODE).includes(mode)) {
      throw new UserError(MESSAGES.BAD_REPEAT, this.language());
    }
    entry.repeat = mode;
    if (entry.queue) await this.preloadNext(entry, renderer);
    await this.publishModes(entry);
  }

  async togglePlayback(externalId) {
    const entry = this.entryOf(externalId);
    const playing = entry.status?.playback === PLAYBACK.PLAYING;
    await this.command(externalId, playing ? RENDERER_FEATURES.PAUSE : RENDERER_FEATURES.PLAY);
    return playing ? PLAYBACK.PAUSED : PLAYBACK.PLAYING;
  }

  async stepVolume(externalId, delta) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    const current = Number.isFinite(entry.status?.volume)
      ? entry.status.volume
      : await renderer.getVolume();
    const target = Math.min(100, Math.max(0, (current ?? 0) + delta));
    await renderer.setVolume(target).catch((err) => this.explainFailure(entry, renderer, err));
    if (entry.status) entry.status.volume = target;
    this.refreshSoon(entry);
    return target;
  }

  /** Set the volume (0-100) when the renderer has one; a scene asks it. */
  async setVolume(externalId, volume) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    if (!renderer.hasVolume) return false;
    await renderer.setVolume(volume).catch((err) => this.explainFailure(entry, renderer, err));
    this.refreshSoon(entry);
    return true;
  }

  /**
   * Play a URL (web radio, announcement); drops the queue. Without a title,
   * a web radio is named after its ICY headers, else after its URL.
   * `favorite`: the favorite this URL plays (see favorites.js).
   */
  async playUrl(externalId, url, { title, volume, favorite } = {}) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    const name = title || (await this.streamTitle(url).catch(() => null)) || undefined;
    entry.queue = null;
    entry.lastPlaying = null;
    entry.playToken += 1;
    entry.loadedUri = url;
    entry.media = { uri: url, title: name ?? '' };
    entry.favorite = favorite
      ? { ...favorite, uri: url, title: name ?? '', queue: false, startedAt: this.now() }
      : null;
    this.onDisplayChange(entry.externalId);
    const failed = (err) => this.explainFailure(entry, renderer, err, { mediaLoaded: true });
    if (Number.isFinite(volume) && renderer.hasVolume) {
      await renderer.setVolume(volume).catch(failed);
    }
    this.refreshSoon(entry);
    // Answer once the renderer accepted Play: waking from standby can take
    // more than a minute, longer than a command or a scene may wait.
    await renderer.playUrl(url, { title: name, verify: false }).catch(failed);
    this.followStart(entry, renderer, url, { title: name });
    return url;
  }

  /**
   * Make sure a playback started without waiting for it (a renderer waking
   * from standby can take more than a minute): Play pressed again while the
   * wake-up ignores it, a clear log line if it never starts.
   */
  followStart(entry, renderer, url, options) {
    const token = entry.playToken;
    this.pending = renderer
      .ensurePlaying(url, { ...options, cancelled: () => entry.playToken !== token })
      // One line per playback that never started (ensurePlaying retries
      // silently and throws once, at the end).
      .catch((err) => logger.warn(`${entry.device.name}: ${err.message}`))
      .finally(() => this.refreshSoon(entry));
  }

  /**
   * Play ContentDirectory items as a queue. Resolves the first track played.
   */
  async playItems(externalId, items, { shuffled = false, favorite } = {}) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    const sink = await renderer.getSink();
    const tracks = items
      .slice(0, MAX_QUEUE)
      .map((item) => trackOf(item, sink))
      .filter(Boolean);
    if (tracks.length === 0) {
      throw new UserError(MESSAGES.NOTHING_PLAYABLE, this.language());
    }
    // The shuffle mode of the player keeps the order to come back to.
    const unshuffled = entry.shuffle && !shuffled ? tracks.slice() : null;
    if (shuffled || entry.shuffle) shuffle(tracks, this.random);
    entry.queue = {
      tracks,
      index: 0,
      preloaded: null,
      noPreload: false,
      startedAt: this.now(),
      unshuffled,
    };
    entry.media = null;
    entry.favorite = favorite ? { ...favorite, queue: true, startedAt: this.now() } : null;
    this.onDisplayChange(entry.externalId);
    await this.startTrack(entry, renderer, tracks[0]).catch((err) =>
      this.explainFailure(entry, renderer, err, { mediaLoaded: true }),
    );
    // The search already used most of the scene's 90 s: the first track is
    // followed in the background, the next ones need no check.
    this.followStart(entry, renderer, tracks[0].uri, { metadata: tracks[0].metadata });
    this.refreshSoon(entry);
    return { track: tracks[0], count: tracks.length };
  }

  /**
   * What the renderer plays when Gladys did not start it as a queue: a track
   * for the queue panel and for an enqueue, or null when nothing plays.
   */
  currentTrack(entry) {
    const status = entry.status;
    if (!status?.uri || ![PLAYBACK.PLAYING, PLAYBACK.PAUSED].includes(status.playback)) {
      return null;
    }
    const known = this.knownTrack(entry, status);
    return {
      uri: status.uri,
      mediaId: null,
      title: status.title || known?.title || titleOfUri(status.uri),
      artist: status.artist || known?.artist || '',
      album: status.album || known?.album || '',
      duration: status.duration || known?.duration || null,
      albumArtUri: status.albumArtUri || known?.albumArtUri || null,
      listArtUri: status.albumArtUri || known?.listArtUri || null,
      // Loaded again by its URL (Previous back to it): no metadata of ours.
      metadata: undefined,
    };
  }

  /**
   * Add ContentDirectory items to the queue: right after the current track
   * (`next`) or at its end (`append`). Something playing that Gladys did not
   * start becomes the first track of a new queue; nothing playing: the items
   * play now. Resolves the number of tracks added.
   */
  async enqueue(externalId, items, mode) {
    const entry = this.entryOf(externalId);
    // The awaits first: a poll may close or replace the queue meanwhile.
    const renderer = await this.rendererOf(entry);
    const sink = await renderer.getSink();
    const tracks = items
      .slice(0, MAX_QUEUE)
      .map((item) => trackOf(item, sink))
      .filter(Boolean);
    if (tracks.length === 0) {
      throw new UserError(MESSAGES.NOTHING_PLAYABLE, this.language());
    }
    let queue = entry.queue;
    if (!queue) {
      const current = this.currentTrack(entry);
      if (!current) {
        const { count } = await this.playItems(externalId, items);
        return count;
      }
      queue = {
        tracks: [current],
        index: 0,
        preloaded: null,
        noPreload: false,
        startedAt: this.now(),
        unshuffled: entry.shuffle ? [current] : null,
      };
      entry.queue = queue;
      entry.favorite = null;
    }
    // Room first taken from the tracks already played.
    const over = queue.tracks.length + tracks.length - MAX_QUEUE;
    if (over > 0) {
      const dropped = queue.tracks.splice(0, Math.min(over, queue.index));
      queue.index -= dropped.length;
      if (queue.unshuffled) {
        const gone = new Set(dropped);
        queue.unshuffled = queue.unshuffled.filter((track) => !gone.has(track));
      }
    }
    const added = tracks.slice(0, MAX_QUEUE - queue.tracks.length);
    if (added.length === 0) {
      throw new UserError(MESSAGES.QUEUE_FULL, this.language());
    }
    const next = mode === MUSIC_PLAY_MODES.NEXT;
    queue.tracks.splice(next ? queue.index + 1 : queue.tracks.length, 0, ...added);
    if (queue.unshuffled) {
      const at = next
        ? queue.unshuffled.indexOf(queue.tracks[queue.index]) + 1
        : queue.unshuffled.length;
      queue.unshuffled.splice(at, 0, ...added);
    }
    await this.preloadNext(entry, renderer);
    this.onDisplayChange(entry.externalId);
    return added.length;
  }

  /**
   * A page of the queue: `{ tracks, currentIndex, total }`. Without a queue
   * of Gladys, what the renderer plays is a queue of one.
   */
  queuePage(externalId, { offset = 0, limit = 50 } = {}) {
    const entry = this.entryOf(externalId);
    const queue = entry.queue;
    if (queue) {
      return {
        tracks: queue.tracks.slice(offset, offset + limit),
        currentIndex: queue.index,
        total: queue.tracks.length,
      };
    }
    const current = this.currentTrack(entry);
    if (!current) return { tracks: [], currentIndex: null, total: 0 };
    return { tracks: offset === 0 ? [current] : [], currentIndex: 0, total: 1 };
  }

  /** Jump to a track of the queue. */
  async playQueueIndex(externalId, index) {
    const entry = this.entryOf(externalId);
    const renderer = await this.rendererOf(entry);
    const queue = entry.queue;
    if (!queue) {
      // The queue of one: what the renderer plays, started again.
      if (index !== 0 || !this.currentTrack(entry)) {
        throw new UserError(MESSAGES.QUEUE_INDEX, this.language());
      }
      await renderer.play().catch((err) => this.explainFailure(entry, renderer, err));
      this.refreshSoon(entry);
      return;
    }
    const track = queue.tracks[index];
    if (!Number.isInteger(index) || !track) {
      throw new UserError(MESSAGES.QUEUE_INDEX, this.language());
    }
    queue.index = index;
    await this.startTrack(entry, renderer, track).catch((err) =>
      this.explainFailure(entry, renderer, err, { mediaLoaded: true }),
    );
    this.onDisplayChange(entry.externalId);
    this.refreshSoon(entry);
  }

  /** What the widget shows of a renderer. */
  viewOf(externalId) {
    const entry = this.entries.get(externalId);
    if (!entry) return null;
    return {
      name: entry.device.name,
      reachable: entry.reachable,
      status: entry.status,
      queue: entry.queue ? { index: entry.queue.index, length: entry.queue.tracks.length } : null,
      hasVolume: this.hasFeature(entry, RENDERER_FEATURES.VOLUME),
      hasMute: this.hasFeature(entry, RENDERER_FEATURES.MUTE),
      favorite: entry.favorite,
    };
  }
}
