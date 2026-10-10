// -----------------------------------------------------------------------------
// Device type: MEDIA RENDERER (TV, amplifier, speaker, streamer…).
//
// The features follow the `music` category of the core, the one its Music
// dashboard widget reads (play, pause, previous, next, volume, playback state)
// and its "play a notification" scene action targets. The core has no music
// "stop" nor "mute", so these two borrow the television remote-control keys,
// which the device card renders as push buttons.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
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
};

// MUSIC_PLAYBACK_STATE of the core: 1 playing, 0 anything else.
export const PLAYBACK_STATE = { PLAYING: 1, NOT_PLAYING: 0 };

// What the "now playing" text shows when the renderer describes nothing (a
// text state is never empty, or the core ignores it).
export const NOTHING_PLAYING = '—';

const NAMES = {
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
  },
};

const { MUSIC, TELEVISION, TEXT } = DEVICE_FEATURE_CATEGORIES;

// key → [category, type, read_only, min, max, keep_history]
const DEFINITIONS = {
  [RENDERER_FEATURES.PLAY]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PLAY, false, 0, 1, false],
  [RENDERER_FEATURES.PAUSE]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PAUSE, false, 0, 1, false],
  [RENDERER_FEATURES.STOP]: [TELEVISION, DEVICE_FEATURE_TYPES.TELEVISION.STOP, false, 0, 1, false],
  [RENDERER_FEATURES.PREVIOUS]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.PREVIOUS, false, 0, 1, false],
  [RENDERER_FEATURES.NEXT]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.NEXT, false, 0, 1, false],
  [RENDERER_FEATURES.VOLUME]: [MUSIC, DEVICE_FEATURE_TYPES.MUSIC.VOLUME, false, 0, 100, false],
  [RENDERER_FEATURES.MUTE]: [
    TELEVISION,
    DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE,
    false,
    0,
    1,
    false,
  ],
  [RENDERER_FEATURES.PLAYBACK_STATE]: [
    MUSIC,
    DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE,
    true,
    0,
    1,
    true,
  ],
  [RENDERER_FEATURES.NOW_PLAYING]: [TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, true, 0, 0, false],
  [RENDERER_FEATURES.NOTIFICATION]: [
    MUSIC,
    DEVICE_FEATURE_TYPES.MUSIC.PLAY_NOTIFICATION,
    false,
    0,
    0,
    false,
  ],
};

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
 * @param {object} info `{ platformId, name, location, udn, manufacturer, modelName, hasVolume, hasMute }`
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
      const [category, type, readOnly, min, max, keepHistory] = DEFINITIONS[key];
      return {
        name: names[key],
        external_id: ids.feature(key),
        category,
        type,
        read_only: readOnly,
        // The volume is read back from the renderer right after a change.
        has_feedback: key === RENDERER_FEATURES.VOLUME,
        keep_history: keepHistory,
        min,
        max,
      };
    }),
  };
}

/** The feature key of one of our renderer feature external_ids. */
export function rendererFeatureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
