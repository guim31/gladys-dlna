// -----------------------------------------------------------------------------
// Dashboard widget "DLNA player" (manifest `widgets`, Gladys 5.1+).
//
// One instance shows one renderer, picked in its settings (`"source":
// "devices"`): what plays, the playback state, the volume, and four buttons.
// The core's own Music widget already offers previous / play / next and a
// volume slider on the same device; this one adds what it lacks: the title,
// the state, stop and volume steps.
//
// Budget of the core (8 components, 2 texts, 4 buttons) and its rules: the
// content is cached until its TTL or a nudge (`requestWidgetRefresh`, sent by
// the poller when the title or the state changes); the volume tile is bound
// to the device feature, so it moves live without any nudge. Buttons are
// widget actions, not device-feature buttons: a push feature keeps the last
// value sent, and its button would stay tinted "active" forever.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { RENDERER_FEATURES } from './devices/renderer.js';
import { PLAYBACK } from './upnp/renderer.js';
import { VOLUME_STEP } from './poller.js';
import { isRenderer } from './servers.js';

const logger = createLogger({ name: 'widgets' });

export const PLAYER_WIDGET = 'player';

export const PLAYER_ACTIONS = {
  TOGGLE: 'toggle',
  STOP: 'stop',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
};

const STATE_LABELS = {
  [PLAYBACK.PLAYING]: { value: { en: 'Playing', fr: 'Lecture' }, color: WIDGET_COLORS.SUCCESS },
  [PLAYBACK.PAUSED]: { value: { en: 'Paused', fr: 'En pause' }, color: WIDGET_COLORS.WARNING },
  [PLAYBACK.STOPPED]: { value: { en: 'Stopped', fr: 'Arrêté' }, color: WIDGET_COLORS.NEUTRAL },
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function message(en, fr) {
  return { components: [{ type: 'text', variant: 'body', text: { en, fr } }] };
}

/** The widget content for one renderer view (see RendererManager.viewOf). */
export function playerContent(externalId, view) {
  if (!view) {
    return {
      ttl_seconds: 300,
      ...message(
        'Pick a DLNA renderer added to Gladys in the widget settings.',
        'Choisissez dans les réglages du widget un lecteur DLNA ajouté à Gladys.',
      ),
    };
  }
  const heading = { type: 'text', variant: 'heading', text: clip(view.name, 40) };
  if (view.reachable === false) {
    return {
      ttl_seconds: 120,
      components: [
        heading,
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'Unreachable: the renderer is off or left the network.',
            fr: 'Injoignable : le lecteur est éteint ou a quitté le réseau.',
          },
        },
      ],
    };
  }

  const status = view.status ?? {};
  const playing = status.playback === PLAYBACK.PLAYING;
  const components = [heading];
  if (view.hasVolume) {
    components.push({
      type: 'gauge',
      label: { en: 'Volume', fr: 'Volume' },
      device_feature: `${externalId}:${RENDERER_FEATURES.VOLUME}`,
    });
  }
  const state = STATE_LABELS[status.playback];
  const nowPlaying = [status.artist, status.title].filter(Boolean).join(' — ');
  const items = [
    {
      label: { en: 'State', fr: 'État' },
      icon: { [PLAYBACK.PLAYING]: 'play', [PLAYBACK.PAUSED]: 'pause' }[status.playback] ?? 'square',
      ...(state ?? { value: '…', color: WIDGET_COLORS.NEUTRAL }),
    },
  ];
  if (nowPlaying) {
    items.push({ label: { en: 'Title', fr: 'Titre' }, icon: 'music', value: clip(nowPlaying, 40) });
  }
  if (status.album) {
    items.push({
      label: { en: 'Album', fr: 'Album' },
      icon: 'disc',
      value: clip(status.album, 40),
    });
  }
  if (view.queue) {
    items.push({
      label: { en: 'Queue', fr: "File d'attente" },
      icon: 'list',
      value: `${view.queue.index + 1} / ${view.queue.length}`,
    });
  }
  if (view.hasMute && typeof status.muted === 'boolean') {
    items.push({
      label: { en: 'Mute', fr: 'Sourdine' },
      icon: status.muted ? 'volume-x' : 'volume-2',
      value: status.muted ? { en: 'On', fr: 'Activée' } : { en: 'Off', fr: 'Désactivée' },
      color: status.muted ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: playing ? { en: 'Pause', fr: 'Pause' } : { en: 'Play', fr: 'Lecture' },
    icon: playing ? 'pause' : 'play',
    action: { key: PLAYER_ACTIONS.TOGGLE },
  });
  components.push({
    type: 'button',
    label: { en: 'Stop', fr: 'Stop' },
    icon: 'square',
    action: { key: PLAYER_ACTIONS.STOP },
  });
  if (view.hasVolume) {
    components.push(
      {
        type: 'button',
        label: { en: 'Volume −', fr: 'Volume −' },
        icon: 'volume-1',
        action: { key: PLAYER_ACTIONS.VOLUME_DOWN },
      },
      {
        type: 'button',
        label: { en: 'Volume +', fr: 'Volume +' },
        icon: 'volume-2',
        action: { key: PLAYER_ACTIONS.VOLUME_UP },
      },
    );
  }
  // The poller nudges on every change shown here: the TTL is a safety net.
  return { ttl_seconds: 300, components };
}

export function createWidgets(context) {
  const { gladys, renderers } = context;
  const viewFor = (settings) =>
    isRenderer(gladys, settings?.device) ? renderers.viewOf(settings.device) : null;

  return {
    [PLAYER_WIDGET]: {
      async get({ settings }) {
        logger.debug(`onWidgetGet <- ${PLAYER_WIDGET} ${settings?.device}`);
        return playerContent(settings?.device, viewFor(settings));
      },

      // The toast is short (the core truncates at 200 characters).
      async action({ actionKey, settings }) {
        if (!viewFor(settings)) {
          throw new Error('Pick a DLNA renderer in the widget settings');
        }
        const externalId = settings.device;
        logger.info(`onWidgetAction <- ${PLAYER_WIDGET}.${actionKey} ${externalId}`);
        switch (actionKey) {
          case PLAYER_ACTIONS.TOGGLE: {
            const now = await renderers.togglePlayback(externalId);
            return now === PLAYBACK.PLAYING
              ? { en: 'Playing', fr: 'Lecture' }
              : { en: 'Paused', fr: 'En pause' };
          }
          case PLAYER_ACTIONS.STOP:
            await renderers.command(externalId, RENDERER_FEATURES.STOP);
            return { en: 'Stopped', fr: 'Arrêté' };
          case PLAYER_ACTIONS.VOLUME_DOWN:
          case PLAYER_ACTIONS.VOLUME_UP: {
            const delta = actionKey === PLAYER_ACTIONS.VOLUME_UP ? VOLUME_STEP : -VOLUME_STEP;
            const volume = await renderers.stepVolume(externalId, delta);
            return { en: `Volume ${volume}%`, fr: `Volume ${volume} %` };
          }
          default:
            throw new Error(`Unknown widget action: ${actionKey}`);
        }
      },
    },
  };
}

/** Freshness nudge for every widget (rate-limited core-side to 1 per 10 s). */
export function refreshWidgets(gladys, widgets) {
  for (const key of Object.keys(widgets)) {
    gladys.requestWidgetRefresh(key);
  }
}
