// -----------------------------------------------------------------------------
// Device type: MEDIA RENDERER (TV, amplifier, speaker, streamer…).
//
// The features follow the `music` category of the core, the one its Music
// dashboard widget reads and its "play a notification" scene action targets.
// Gladys 5.3 made it a real player: the playback state is writable (pause,
// play, stop), and the renderer publishes what it plays (title, artist,
// album, artwork, duration, position) plus shuffle, repeat and mute, all
// through publishNowPlaying (src/poller.js).
//
// Before 5.3 the core had no music "mute": 1.x borrowed the television key
// (a push button that toggles). Same external id, now music/mute: the core
// converts it when the user accepts "Update" in the Discovery tab. Stop keeps
// its television key (writing 2 to the playback state is the 5.3 stop).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  MUSIC_PLAYBACK_STATE,
} from '@gladysassistant/integration-sdk';
import { DEVICE_KINDS, deviceParams } from './index.js';

// Feature keys: part of the external ids, frozen once published.
export const RENDERER_FEATURES = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  PREVIOUS: 'previous',
  NEXT: 'next',
  VOLUME: 'volume',
  MUTE: 'mute',
  PLAYBACK_STATE: 'playback-state',
  NOW_PLAYING: 'now-playing',
  NOTIFICATION: 'notification',
  // Gladys 5.3: the external ids publishNowPlaying builds by default
  // (`<device>:<type>`).
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  SHUFFLE: 'shuffle',
  REPEAT: 'repeat',
};

// MUSIC_PLAYBACK_STATE of the core: 0 paused, 1 playing, 2 idle (stopped,
// nothing loaded), 3 buffering (reported only).
export const PLAYBACK_STATE = MUSIC_PLAYBACK_STATE;

// The longest duration or position published, in seconds (the max of the
// features): a day.
export const MAX_SECONDS = 86_400;

// What the "now playing" text shows when the renderer describes nothing (a
// text state is never empty, or the core ignores it).
export const NOTHING_PLAYING = '—';

// Feature names per configured language (frozen by Gladys once a device is
// added).
export const NAMES = {
  en: {
    [RENDERER_FEATURES.PLAY]: 'Play',
    [RENDERER_FEATURES.PAUSE]: 'Pause',
    [RENDERER_FEATURES.STOP]: 'Stop',
    [RENDERER_FEATURES.PREVIOUS]: 'Previous',
    [RENDERER_FEATURES.NEXT]: 'Next',
    [RENDERER_FEATURES.VOLUME]: 'Volume',
    [RENDERER_FEATURES.MUTE]: 'Mute',
    [RENDERER_FEATURES.PLAYBACK_STATE]: 'Playback state',
    [RENDERER_FEATURES.NOW_PLAYING]: 'Now playing',
    [RENDERER_FEATURES.NOTIFICATION]: 'Notification',
    [RENDERER_FEATURES.TITLE]: 'Title',
    [RENDERER_FEATURES.ARTIST]: 'Artist',
    [RENDERER_FEATURES.ALBUM]: 'Album',
    [RENDERER_FEATURES.ARTWORK]: 'Artwork',
    [RENDERER_FEATURES.DURATION]: 'Duration',
    [RENDERER_FEATURES.POSITION]: 'Position',
    [RENDERER_FEATURES.SHUFFLE]: 'Shuffle',
    [RENDERER_FEATURES.REPEAT]: 'Repeat',
  },
  fr: {
    [RENDERER_FEATURES.PLAY]: 'Lecture',
    [RENDERER_FEATURES.PAUSE]: 'Pause',
    [RENDERER_FEATURES.STOP]: 'Stop',
    [RENDERER_FEATURES.PREVIOUS]: 'Précédent',
    [RENDERER_FEATURES.NEXT]: 'Suivant',
    [RENDERER_FEATURES.VOLUME]: 'Volume',
    [RENDERER_FEATURES.MUTE]: 'Sourdine',
    [RENDERER_FEATURES.PLAYBACK_STATE]: 'État de lecture',
    [RENDERER_FEATURES.NOW_PLAYING]: 'En cours de lecture',
    [RENDERER_FEATURES.NOTIFICATION]: 'Notification',
    [RENDERER_FEATURES.TITLE]: 'Titre',
    [RENDERER_FEATURES.ARTIST]: 'Artiste',
    [RENDERER_FEATURES.ALBUM]: 'Album',
    [RENDERER_FEATURES.ARTWORK]: 'Pochette',
    [RENDERER_FEATURES.DURATION]: 'Durée',
    [RENDERER_FEATURES.POSITION]: 'Position',
    [RENDERER_FEATURES.SHUFFLE]: 'Lecture aléatoire',
    [RENDERER_FEATURES.REPEAT]: 'Répétition',
  },
  de: {
    [RENDERER_FEATURES.PLAY]: 'Wiedergabe',
    [RENDERER_FEATURES.PAUSE]: 'Pause',
    [RENDERER_FEATURES.STOP]: 'Stopp',
    [RENDERER_FEATURES.PREVIOUS]: 'Vorheriger Titel',
    [RENDERER_FEATURES.NEXT]: 'Nächster Titel',
    [RENDERER_FEATURES.VOLUME]: 'Lautstärke',
    [RENDERER_FEATURES.MUTE]: 'Stumm',
    [RENDERER_FEATURES.PLAYBACK_STATE]: 'Wiedergabestatus',
    [RENDERER_FEATURES.NOW_PLAYING]: 'Aktuelle Wiedergabe',
    [RENDERER_FEATURES.NOTIFICATION]: 'Benachrichtigung',
    [RENDERER_FEATURES.TITLE]: 'Titel',
    [RENDERER_FEATURES.ARTIST]: 'Interpret',
    [RENDERER_FEATURES.ALBUM]: 'Album',
    [RENDERER_FEATURES.ARTWORK]: 'Cover',
    [RENDERER_FEATURES.DURATION]: 'Dauer',
    [RENDERER_FEATURES.POSITION]: 'Position',
    [RENDERER_FEATURES.SHUFFLE]: 'Zufallswiedergabe',
    [RENDERER_FEATURES.REPEAT]: 'Wiederholen',
  },
  es: {
    [RENDERER_FEATURES.PLAY]: 'Reproducir',
    [RENDERER_FEATURES.PAUSE]: 'Pausa',
    [RENDERER_FEATURES.STOP]: 'Detener',
    [RENDERER_FEATURES.PREVIOUS]: 'Anterior',
    [RENDERER_FEATURES.NEXT]: 'Siguiente',
    [RENDERER_FEATURES.VOLUME]: 'Volumen',
    [RENDERER_FEATURES.MUTE]: 'Silencio',
    [RENDERER_FEATURES.PLAYBACK_STATE]: 'Estado de reproducción',
    [RENDERER_FEATURES.NOW_PLAYING]: 'Reproduciendo ahora',
    [RENDERER_FEATURES.NOTIFICATION]: 'Notificación',
    [RENDERER_FEATURES.TITLE]: 'Título',
    [RENDERER_FEATURES.ARTIST]: 'Artista',
    [RENDERER_FEATURES.ALBUM]: 'Álbum',
    [RENDERER_FEATURES.ARTWORK]: 'Carátula',
    [RENDERER_FEATURES.DURATION]: 'Duración',
    [RENDERER_FEATURES.POSITION]: 'Posición',
    [RENDERER_FEATURES.SHUFFLE]: 'Aleatorio',
    [RENDERER_FEATURES.REPEAT]: 'Repetir',
  },
};

const { MUSIC, TELEVISION, TEXT } = DEVICE_FEATURE_CATEGORIES;
const TYPES = DEVICE_FEATURE_TYPES.MUSIC;

// key → [category, type, read_only, min, max, keep_history]. The core forces
// keep_history off on the whole music category (5.3).
const DEFINITIONS = {
  [RENDERER_FEATURES.PLAY]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PLAY, false, 0, 1, false],
  [RENDERER_FEATURES.PAUSE]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PAUSE, false, 0, 1, false],
  [RENDERER_FEATURES.STOP]: [TELEVISION, DEVICE_FEATURE_TYPES.TELEVISION.STOP, false, 0, 1, false],
  [RENDERER_FEATURES.PREVIOUS]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PREVIOUS, false, 0, 1, false],
  [RENDERER_FEATURES.NEXT]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.NEXT, false, 0, 1, false],
  [RENDERER_FEATURES.VOLUME]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.VOLUME, false, 0, 100, false],
  [RENDERER_FEATURES.MUTE]: [MUSIC, TYPES.MUTE, false, 0, 1, false],
  // Writable since 5.3: 0 pause, 1 play, 2 stop (3, buffering, is reported
  // only).
  [RENDERER_FEATURES.PLAYBACK_STATE]: [MUSIC, TYPES.PLAYBACK_STATE, false, 0, 2, false],
  [RENDERER_FEATURES.NOW_PLAYING]: [TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, true, 0, 0, false],
  [RENDERER_FEATURES.NOTIFICATION]: [
    MUSIC,
    DEVICE_FEATURE_TYPES.MUSIC.PLAY_NOTIFICATION,
    false,
    0,
    0,
    false,
  ],
  [RENDERER_FEATURES.TITLE]: [MUSIC, TYPES.TITLE, true, 0, 0, false],
  [RENDERER_FEATURES.ARTIST]: [MUSIC, TYPES.ARTIST, true, 0, 0, false],
  [RENDERER_FEATURES.ALBUM]: [MUSIC, TYPES.ALBUM, true, 0, 0, false],
  [RENDERER_FEATURES.ARTWORK]: [MUSIC, TYPES.ARTWORK, true, 0, 0, false],
  [RENDERER_FEATURES.DURATION]: [MUSIC, TYPES.DURATION, true, 0, MAX_SECONDS, false],
  // Read-only when the renderer has no Seek (see buildRendererDevice).
  [RENDERER_FEATURES.POSITION]: [MUSIC, TYPES.POSITION, false, 0, MAX_SECONDS, false],
  // Shuffle and repeat apply to the play queue of the integration.
  [RENDERER_FEATURES.SHUFFLE]: [MUSIC, TYPES.SHUFFLE, false, 0, 1, false],
  [RENDERER_FEATURES.REPEAT]: [MUSIC, TYPES.REPEAT, false, 0, 2, false],
};

const SECONDS = new Set([RENDERER_FEATURES.DURATION, RENDERER_FEATURES.POSITION]);

// The states a command changes (the push buttons play, pause, stop, next,
// previous and notification have no state to confirm).
const WITH_FEEDBACK = new Set([
  RENDERER_FEATURES.VOLUME,
  RENDERER_FEATURES.MUTE,
  RENDERER_FEATURES.PLAYBACK_STATE,
  RENDERER_FEATURES.POSITION,
  RENDERER_FEATURES.SHUFFLE,
  RENDERER_FEATURES.REPEAT,
]);

/** The feature keys a renderer publishes, from what its SCPDs declare. */
export function rendererFeatureKeys({ hasVolume = true, hasMute = true } = {}) {
  return Object.values(RENDERER_FEATURES).filter(
    (key) =>
      (key !== RENDERER_FEATURES.VOLUME || hasVolume) &&
      (key !== RENDERER_FEATURES.MUTE || hasMute),
  );
}

/**
 * The discovery payload of a renderer.
 * @param {object} info `{ platformId, name, location, udn, manufacturer, modelName, hasVolume, hasMute, canSeek }`
 *   `canSeek` false (the SCPD declares no Seek): the position is read-only.
 */
export function buildRendererDevice(gladys, info, config) {
  const ids = gladys.externalIds(DEVICE_KINDS.RENDERER, info.platformId);
  const names = NAMES[config.language] ?? NAMES.en;
  return {
    name: info.name,
    external_id: ids.device,
    // The state is polled from the container at an adaptive pace (faster while
    // playing): the core scheduler only knows fixed paces (see src/poller.js).
    should_poll: false,
    params: deviceParams(info),
    features: rendererFeatureKeys(info).map((key) => {
      const [category, type, readOnlyByDefault, min, max, keepHistory] = DEFINITIONS[key];
      const readOnly =
        readOnlyByDefault || (key === RENDERER_FEATURES.POSITION && info.canSeek === false);
      const feature = {
        name: names[key],
        external_id: ids.feature(key),
        category,
        type,
        read_only: readOnly,
        // A writable state (not a push button) is confirmed by the renderer:
        // read back right after a change, Gladys saves nothing itself.
        has_feedback: !readOnly && WITH_FEEDBACK.has(key),
        keep_history: keepHistory,
        min,
        max,
      };
      if (SECONDS.has(key)) feature.unit = DEVICE_FEATURE_UNITS.SECONDS;
      return feature;
    }),
  };
}

/** The feature key of one of our renderer feature external_ids. */
export function rendererFeatureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
