// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// "DLNA player": one instance shows one renderer, picked in its settings
// (`"source": "devices"`): what plays, the playback state, the volume, and
// four buttons. The core's own Music widget already offers previous / play /
// next and a volume slider on the same device; this one adds what it lacks:
// the title, the state, stop and volume steps.
//
// "DLNA favorites": up to four favorites of the configuration as buttons
// (the core allows four buttons per widget: several instances show more),
// and the favorite the renderer holds now.
//
// Budget of the core (8 components, 2 texts, 4 buttons) and its rules: the
// content is cached until its TTL or a nudge (`requestWidgetRefresh`, sent by
// the poller when the title or the state changes); the volume tile is bound
// to the device feature, so it moves live without any nudge. Buttons are
// widget actions, not device-feature buttons: a push feature keeps the last
// value sent, and its button would stay tinted "active" forever. The current
// favorite is told by its icon, never by a button style (#3153: `primary`
// does not show in dark mode).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { RENDERER_FEATURES } from './devices/renderer.js';
import { PLAYBACK } from './upnp/renderer.js';
import { VOLUME_STEP } from './poller.js';
import { isRenderer } from './servers.js';
import { NoDlnaMediaError, STOP_WITHOUT_DLNA_MEDIA } from './errors.js';
import { FAVORITE_SLOTS } from './config.js';
import { FAVORITE_KINDS, favoriteOf, favoritesOf, isCurrent, playFavorite } from './favorites.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';
import { languageOf } from './playback.js';

const logger = createLogger({ name: 'widgets' });

export const PLAYER_WIDGET = 'player';
export const FAVORITES_WIDGET = 'favorites';

export const PLAYER_ACTIONS = {
  TOGGLE: 'toggle',
  STOP: 'stop',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
};

// The buttons the core keeps per widget: one favorite each.
export const FAVORITES_PER_WIDGET = 4;
// `play_1` … `play_8`: one key per favorite (the core drops a button whose
// action key is already taken).
export const favoriteActionKey = (slot) => `play_${slot}`;
const FAVORITE_ACTION = /^play_(\d+)$/;

// A favorite search from a widget ends before its action_timeout_seconds
// (60 s in the manifest).
export const WIDGET_SEARCH_BUDGET_MS = 50000;

/** The texts of the widgets, for the translation tests. */
export const TEXTS = {
  PLAYING: { en: 'Playing', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  PAUSED: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  STOPPED: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  PICK_RENDERER: {
    en: 'Pick a DLNA renderer added to Gladys in the widget settings.',
    fr: 'Choisissez dans les réglages du widget un lecteur DLNA ajouté à Gladys.',
    de: 'Wählen Sie in den Widget-Einstellungen ein zu Gladys hinzugefügtes DLNA-Wiedergabegerät.',
    es: 'Elija en la configuración del widget un reproductor DLNA añadido a Gladys.',
  },
  UNREACHABLE: {
    en: 'Unreachable: the renderer is off or left the network.',
    fr: 'Injoignable : le lecteur est éteint ou a quitté le réseau.',
    de: 'Nicht erreichbar: Das Gerät ist aus oder hat das Netzwerk verlassen.',
    es: 'Inaccesible: el reproductor está apagado o ha salido de la red.',
  },
  NO_FAVORITE: {
    en: 'No favorite yet: add some in the configuration of the DLNA integration.',
    fr: "Aucun favori pour l'instant : ajoutez-en dans la configuration de l'intégration DLNA.",
    de: 'Noch keine Favoriten: Fügen Sie welche in der Konfiguration der DLNA-Integration hinzu.',
    es: 'Aún no hay favoritos: añádalos en la configuración de la integración DLNA.',
  },
  VOLUME: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  STATE: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  TITLE: { en: 'Title', fr: 'Titre', de: 'Titel', es: 'Título' },
  ALBUM: { en: 'Album', fr: 'Album', de: 'Album', es: 'Álbum' },
  QUEUE: { en: 'Queue', fr: "File d'attente", de: 'Warteschlange', es: 'Cola' },
  MUTE: { en: 'Mute', fr: 'Sourdine', de: 'Stumm', es: 'Silencio' },
  ON: { en: 'On', fr: 'Activée', de: 'Ein', es: 'Activado' },
  OFF: { en: 'Off', fr: 'Désactivée', de: 'Aus', es: 'Desactivado' },
  FAVORITE: { en: 'Favorite', fr: 'Favori', de: 'Favorit', es: 'Favorito' },
  NONE: { en: 'None', fr: 'Aucun', de: 'Keiner', es: 'Ninguno' },
  BUTTON_PLAY: { en: 'Play', fr: 'Lecture', de: 'Abspielen', es: 'Reproducir' },
  BUTTON_PAUSE: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  BUTTON_STOP: { en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Detener' },
  BUTTON_VOLUME_DOWN: { en: 'Volume −', fr: 'Volume −', de: 'Lautstärke −', es: 'Volumen −' },
  BUTTON_VOLUME_UP: { en: 'Volume +', fr: 'Volume +', de: 'Lautstärke +', es: 'Volumen +' },
  volumeSet: (volume) => ({
    en: `Volume ${volume}%`,
    fr: `Volume ${volume} %`,
    de: `Lautstärke ${volume} %`,
    es: `Volumen ${volume} %`,
  }),
  favoriteStarted: (name) => ({
    en: `Playing ${name}`,
    fr: `Lecture de ${name}`,
    de: `${name} wird abgespielt`,
    es: `Reproduciendo ${name}`,
  }),
};

const STATE_LABELS = {
  [PLAYBACK.PLAYING]: { value: TEXTS.PLAYING, color: WIDGET_COLORS.SUCCESS },
  [PLAYBACK.PAUSED]: { value: TEXTS.PAUSED, color: WIDGET_COLORS.WARNING },
  [PLAYBACK.STOPPED]: { value: TEXTS.STOPPED, color: WIDGET_COLORS.NEUTRAL },
};
const PLAYBACK_ICONS = { [PLAYBACK.PLAYING]: 'play', [PLAYBACK.PAUSED]: 'pause' };

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const body = (text) => ({ type: 'text', variant: 'body', text });
const heading = (view) => ({ type: 'text', variant: 'heading', text: clip(view.name, 40) });

/** The content of a widget whose renderer is missing or unreachable, or null. */
function unavailable(view) {
  if (!view) {
    return { ttl_seconds: 300, components: [body(TEXTS.PICK_RENDERER)] };
  }
  if (view.reachable === false) {
    return {
      ttl_seconds: 120,
      components: [heading(view), body(TEXTS.UNREACHABLE)],
    };
  }
  return null;
}

/** The widget content for one renderer view (see RendererManager.viewOf). */
export function playerContent(externalId, view) {
  const fallback = unavailable(view);
  if (fallback) return fallback;

  const status = view.status ?? {};
  const playing = status.playback === PLAYBACK.PLAYING;
  const components = [heading(view)];
  if (view.hasVolume) {
    components.push({
      type: 'gauge',
      label: TEXTS.VOLUME,
      device_feature: `${externalId}:${RENDERER_FEATURES.VOLUME}`,
    });
  }
  const state = STATE_LABELS[status.playback];
  const nowPlaying = [status.artist, status.title].filter(Boolean).join(' — ');
  const items = [
    {
      label: TEXTS.STATE,
      icon: PLAYBACK_ICONS[status.playback] ?? 'square',
      ...(state ?? { value: '…', color: WIDGET_COLORS.NEUTRAL }),
    },
  ];
  if (nowPlaying) {
    items.push({ label: TEXTS.TITLE, icon: 'music', value: clip(nowPlaying, 40) });
  }
  if (status.album) {
    items.push({ label: TEXTS.ALBUM, icon: 'disc', value: clip(status.album, 40) });
  }
  if (view.queue) {
    items.push({
      label: TEXTS.QUEUE,
      icon: 'list',
      value: `${view.queue.index + 1} / ${view.queue.length}`,
    });
  }
  if (view.hasMute && typeof status.muted === 'boolean') {
    items.push({
      label: TEXTS.MUTE,
      icon: status.muted ? 'volume-x' : 'volume-2',
      value: status.muted ? TEXTS.ON : TEXTS.OFF,
      color: status.muted ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: playing ? TEXTS.BUTTON_PAUSE : TEXTS.BUTTON_PLAY,
    icon: playing ? 'pause' : 'play',
    action: { key: PLAYER_ACTIONS.TOGGLE },
  });
  components.push({
    type: 'button',
    label: TEXTS.BUTTON_STOP,
    icon: 'square',
    action: { key: PLAYER_ACTIONS.STOP },
  });
  if (view.hasVolume) {
    components.push(
      {
        type: 'button',
        label: TEXTS.BUTTON_VOLUME_DOWN,
        icon: 'volume-1',
        action: { key: PLAYER_ACTIONS.VOLUME_DOWN },
      },
      {
        type: 'button',
        label: TEXTS.BUTTON_VOLUME_UP,
        icon: 'volume-2',
        action: { key: PLAYER_ACTIONS.VOLUME_UP },
      },
    );
  }
  // The poller nudges on every change shown here: the TTL is a safety net.
  return { ttl_seconds: 300, components };
}

/**
 * The favorites a widget shows: the slots picked in its settings that are
 * configured, else the configured ones; four at most, in slot order.
 */
export function shownFavorites(config, picked) {
  const slots = (Array.isArray(picked) ? picked : [])
    .map(String)
    .filter((slot) => FAVORITE_SLOTS.includes(slot));
  const favorites = slots.length
    ? FAVORITE_SLOTS.filter((slot) => slots.includes(slot))
        .map((slot) => favoriteOf(config, slot))
        .filter(Boolean)
    : favoritesOf(config);
  return favorites.slice(0, FAVORITES_PER_WIDGET);
}

/**
 * The "DLNA favorites" content for one renderer view and its favorites.
 * `playing`: the configured favorite the renderer holds, shown even when it
 * has no button in this widget.
 */
export function favoritesContent(view, favorites, playing = null) {
  const fallback = unavailable(view);
  if (fallback) return fallback;
  const components = [heading(view)];
  if (favorites.length === 0) {
    components.push(body(TEXTS.NO_FAVORITE));
    return { ttl_seconds: 300, components };
  }
  const current = [playing, ...favorites].find(
    (favorite) => favorite && isCurrent(favorite, view.favorite),
  );
  const playback = view.status?.playback;
  components.push({
    type: 'status',
    items: [
      current
        ? {
            label: TEXTS.FAVORITE,
            icon: PLAYBACK_ICONS[playback] ?? 'square',
            value: clip(current.name, 40),
            color: playback === PLAYBACK.PLAYING ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
          }
        : {
            label: TEXTS.FAVORITE,
            icon: 'star',
            value: TEXTS.NONE,
            color: WIDGET_COLORS.NEUTRAL,
          },
    ],
  });
  for (const favorite of favorites) {
    components.push({
      type: 'button',
      label: clip(favorite.name, 24),
      icon:
        current?.slot === favorite.slot
          ? 'check-circle'
          : favorite.kind === FAVORITE_KINDS.URL
            ? 'radio'
            : 'music',
      action: { key: favoriteActionKey(favorite.slot) },
    });
  }
  return { ttl_seconds: 300, components };
}

export function createWidgets(context) {
  const { gladys, renderers } = context;
  const viewFor = (settings) =>
    isRenderer(gladys, settings?.device) ? renderers.viewOf(settings.device) : null;
  const requireView = (settings) => {
    if (!viewFor(settings)) {
      throw new UserError(MESSAGES.PICK_RENDERER_WIDGET, languageOf(context));
    }
  };

  return {
    [PLAYER_WIDGET]: {
      async get({ settings }) {
        logger.debug(`onWidgetGet <- ${PLAYER_WIDGET} ${settings?.device}`);
        return playerContent(settings?.device, viewFor(settings));
      },

      // The toast is short (the core truncates at 200 characters).
      async action({ actionKey, settings }) {
        requireView(settings);
        const externalId = settings.device;
        logger.info(`onWidgetAction <- ${PLAYER_WIDGET}.${actionKey} ${externalId}`);
        try {
          return await runPlayerAction(externalId, actionKey);
        } catch (err) {
          // Not a failure of Gladys: the device plays another source. A
          // resolved message is shown in the user's language (an error
          // only in the configured one, after "The action failed.").
          if (err instanceof NoDlnaMediaError) return err.text;
          throw err;
        }
      },
    },

    [FAVORITES_WIDGET]: {
      async get({ settings }) {
        logger.debug(`onWidgetGet <- ${FAVORITES_WIDGET} ${settings?.device}`);
        const config = context.config();
        const view = viewFor(settings);
        return favoritesContent(
          view,
          shownFavorites(config, settings?.favorites),
          view?.favorite ? favoriteOf(config, view.favorite.slot) : null,
        );
      },

      async action({ actionKey, settings }) {
        requireView(settings);
        const slot = actionKey.match(FAVORITE_ACTION)?.[1];
        if (!slot) throw new Error(`Unknown widget action: ${actionKey}`);
        logger.info(`onWidgetAction <- ${FAVORITES_WIDGET}.${actionKey} ${settings.device}`);
        const { started, name } = await playFavorite(context, settings.device, slot, {
          budgetMs: WIDGET_SEARCH_BUDGET_MS,
        });
        return started ? TEXTS.favoriteStarted(name) : MESSAGES.NOTHING_FOUND;
      },
    },
  };

  async function runPlayerAction(externalId, actionKey) {
    switch (actionKey) {
      case PLAYER_ACTIONS.TOGGLE: {
        const now = await renderers.togglePlayback(externalId);
        return now === PLAYBACK.PLAYING ? TEXTS.PLAYING : TEXTS.PAUSED;
      }
      case PLAYER_ACTIONS.STOP: {
        const { noDlnaMedia } = await renderers.command(externalId, RENDERER_FEATURES.STOP, 1, {
          checkMedia: true,
        });
        // Never a "Stopped" that may be false (see RendererManager.command).
        return noDlnaMedia ? STOP_WITHOUT_DLNA_MEDIA : TEXTS.STOPPED;
      }
      case PLAYER_ACTIONS.VOLUME_DOWN:
      case PLAYER_ACTIONS.VOLUME_UP: {
        const delta = actionKey === PLAYER_ACTIONS.VOLUME_UP ? VOLUME_STEP : -VOLUME_STEP;
        const volume = await renderers.stepVolume(externalId, delta);
        return TEXTS.volumeSet(volume);
      }
      default:
        throw new Error(`Unknown widget action: ${actionKey}`);
    }
  }
}

/** Freshness nudge for every widget (rate-limited core-side to 1 per 10 s). */
export function refreshWidgets(gladys, widgets) {
  for (const key of Object.keys(widgets)) {
    gladys.requestWidgetRefresh(key);
  }
}
