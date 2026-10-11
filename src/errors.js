// -----------------------------------------------------------------------------
// What the user reads when a renderer refuses a command.
//
// A renderer answers a refusal with a UPnP error code ("Play failed: 701
// Transition not available"): meaningless on a dashboard. The core shows the
// error text of a widget button under its own "The action failed." and keeps
// those of device commands and scene actions in its logs, without knowing the
// language: the text is chosen from the `language` of the configuration. The
// raw code stays in the logs of the integration.
//
// The codes and their labels are those of the UPnP specifications: Device
// Architecture 1.0 (section 3.2.2) and the "common error codes" of
// AVTransport:1 and RenderingControl:1.
// -----------------------------------------------------------------------------

import { UpnpError } from './upnp/soap.js';

const AV_TRANSPORT = 'AVTransport';

// AVTransport codes that tell the transport has nothing to act on.
// 701 "Transition not available": Play, Pause, Stop or Next refused in the
// current state, typically with no DLNA media loaded (the device plays
// Spotify, AirPlay or an input of its own). 702 "No contents".
const NO_MEDIA_CODES = ['701', '702'];

/** The transport commands a user presses. */
export const COMMANDS = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  NEXT: 'next',
  PREVIOUS: 'previous',
};

const COMMAND_OF_ACTION = {
  Play: COMMANDS.PLAY,
  Pause: COMMANDS.PAUSE,
  Stop: COMMANDS.STOP,
  Next: COMMANDS.NEXT,
  Previous: COMMANDS.PREVIOUS,
};

const OTHER_SOURCE = {
  en: 'the renderer may be playing another source (Spotify, AirPlay, HDMI input…)',
  fr: 'le lecteur joue peut-être une autre source (Spotify, AirPlay, entrée HDMI…)',
};

/** No DLNA media to act on: the device plays something else, or nothing. */
export const NO_DLNA_MEDIA = {
  [COMMANDS.PLAY]: {
    en: `Nothing to play over DLNA: ${OTHER_SOURCE.en}. Start a media from Gladys, or use the app of that source.`,
    fr: "Le lecteur n'a rien à lire en DLNA : il joue peut-être une autre source (Spotify, AirPlay, entrée HDMI…). Lancez un média depuis Gladys, ou utilisez l'application de cette source.",
  },
  [COMMANDS.PAUSE]: {
    en: `Nothing to pause over DLNA: ${OTHER_SOURCE.en}. Pause it from the app of that source.`,
    fr: `Rien à mettre en pause en DLNA : ${OTHER_SOURCE.fr}. Mettez-la en pause depuis l'application de cette source.`,
  },
  [COMMANDS.STOP]: {
    en: `Nothing to stop over DLNA: ${OTHER_SOURCE.en}. Stop it from the app of that source.`,
    fr: `Rien à arrêter en DLNA : ${OTHER_SOURCE.fr}. Arrêtez-la depuis l'application de cette source.`,
  },
  [COMMANDS.NEXT]: {
    en: `No next track over DLNA: ${OTHER_SOURCE.en}. Change track from the app of that source.`,
    fr: `Pas de piste suivante en DLNA : ${OTHER_SOURCE.fr}. Changez de piste depuis l'application de cette source.`,
  },
  [COMMANDS.PREVIOUS]: {
    en: `No previous track over DLNA: ${OTHER_SOURCE.en}. Change track from the app of that source.`,
    fr: `Pas de piste précédente en DLNA : ${OTHER_SOURCE.fr}. Changez de piste depuis l'application de cette source.`,
  },
};

/** Stop accepted while no DLNA media was loaded: it may have done nothing. */
export const STOP_WITHOUT_DLNA_MEDIA = {
  en: 'Stop sent, but no DLNA media is loaded: if another source plays (Spotify, AirPlay, HDMI input…), stop it from the app of that source.',
  fr: "Stop envoyé, mais aucun média DLNA n'est chargé : si une autre source joue (Spotify, AirPlay, entrée HDMI…), arrêtez-la depuis l'application de cette source.",
};

// 701 while a DLNA media is loaded: the command does not apply right now.
const TRANSITION_NOT_AVAILABLE = {
  [COMMANDS.PLAY]: {
    en: 'The renderer cannot start playing right now (transition not available): it may be waking up or switching source. Try again in a moment.',
    fr: 'Le lecteur ne peut pas lancer la lecture pour le moment (transition impossible) : il sort peut-être de veille ou change de source. Réessayez dans un instant.',
  },
  [COMMANDS.PAUSE]: {
    en: 'The renderer cannot pause this media (transition not available): a live stream often cannot be paused. Use Stop.',
    fr: 'Le lecteur ne peut pas mettre ce média en pause (transition impossible) : un flux en direct ne se met souvent pas en pause. Utilisez Stop.',
  },
  [COMMANDS.STOP]: {
    en: 'The renderer cannot stop right now (transition not available). Try again in a moment.',
    fr: "Le lecteur ne peut pas s'arrêter pour le moment (transition impossible). Réessayez dans un instant.",
  },
  [COMMANDS.NEXT]: {
    en: 'No next track: the renderer plays a single media (transition not available).',
    fr: 'Pas de piste suivante : le lecteur lit un média seul (transition impossible).',
  },
  [COMMANDS.PREVIOUS]: {
    en: 'No previous track: the renderer plays a single media (transition not available).',
    fr: 'Pas de piste précédente : le lecteur lit un média seul (transition impossible).',
  },
  other: {
    en: 'The renderer refuses this command in its current state (transition not available).',
    fr: 'Le lecteur refuse cette commande dans son état actuel (transition impossible).',
  },
};

const UNSUPPORTED_FORMAT = {
  en: 'The renderer does not accept the format of this media (illegal MIME type).',
  fr: "Le lecteur n'accepte pas le format de ce média (type MIME refusé).",
};
const INVALID_INSTANCE = {
  en: 'The renderer refused the command (invalid InstanceID). Restart the renderer if this persists.',
  fr: 'Le lecteur a refusé la commande (InstanceID invalide). Redémarrez-le si cela persiste.',
};
const NOT_SUPPORTED = {
  en: 'The renderer does not support this command (invalid action).',
  fr: 'Le lecteur ne prend pas en charge cette commande (action invalide).',
};
const INVALID_ARGS = {
  en: 'The renderer refused the values of this command (invalid args).',
  fr: 'Le lecteur a refusé les valeurs de cette commande (arguments invalides).',
};

// AVTransport:1 (the codes a renderer answers to the commands this
// integration sends).
const AV_TRANSPORT_MESSAGES = {
  703: {
    en: 'The renderer could not read the media (read error).',
    fr: "Le lecteur n'a pas pu lire le média (erreur de lecture).",
  },
  704: {
    en: 'The renderer does not support the format of this media for playback.',
    fr: 'Le lecteur ne prend pas en charge le format de ce média en lecture.',
  },
  705: {
    en: 'The renderer is locked by another controller (transport is locked).',
    fr: 'Le lecteur est verrouillé par un autre contrôleur (transport verrouillé).',
  },
  714: UNSUPPORTED_FORMAT,
  715: {
    en: 'The media is busy (content busy). Try again in a moment.',
    fr: 'Le média est occupé. Réessayez dans un instant.',
  },
  716: {
    en: 'The renderer cannot reach the media (resource not found): check that its address is reachable from the renderer.',
    fr: "Le lecteur n'atteint pas le média (ressource introuvable) : vérifiez que son adresse est joignable depuis le lecteur.",
  },
  717: {
    en: 'The renderer does not support this play speed.',
    fr: 'Le lecteur ne prend pas en charge cette vitesse de lecture.',
  },
  718: INVALID_INSTANCE,
};

// RenderingControl:1.
const RENDERING_CONTROL_MESSAGES = {
  702: INVALID_INSTANCE,
};

// UPnP Device Architecture 1.0, section 3.2.2: every service.
const COMMON_MESSAGES = {
  401: NOT_SUPPORTED,
  402: INVALID_ARGS,
  501: {
    en: 'The renderer could not carry out the command (action failed): it may be in standby or busy. Try again in a moment.',
    fr: "Le lecteur n'a pas pu exécuter la commande (échec de l'action) : il est peut-être en veille ou occupé. Réessayez dans un instant.",
  },
  600: INVALID_ARGS,
  601: INVALID_ARGS,
  602: NOT_SUPPORTED,
};

const REFUSED = {
  en: 'The renderer refused the command.',
  fr: 'Le lecteur a refusé la commande.',
};

/** An error whose message is meant for the user, in `{ en, fr }`. */
export class UserError extends Error {
  constructor(text, language = 'en', cause) {
    super(text[language] ?? text.en, { cause });
    this.name = 'UserError';
    this.text = text;
  }
}

/** The renderer has no DLNA media to act on. */
export class NoDlnaMediaError extends UserError {
  constructor(text, language, cause) {
    super(text, language, cause);
    this.name = 'NoDlnaMediaError';
  }
}

const isAvTransport = (err) => String(err.serviceType ?? '').includes(`:${AV_TRANSPORT}:`);

/** True when the renderer refused an AVTransport command for lack of media. */
export function isNoMediaRefusal(err) {
  return err instanceof UpnpError && isAvTransport(err) && NO_MEDIA_CODES.includes(err.code);
}

/**
 * The user text of a UPnP refusal. `command` is what the user asked (Pause
 * may be sent as Stop), the action of the error otherwise. `mediaLoaded`:
 * true when a DLNA media is known to be loaded, false when known not to be,
 * undefined when unknown (a 701 then reads as "no DLNA media").
 */
export function explainUpnpError(err, { command, mediaLoaded } = {}) {
  const asked = command ?? COMMAND_OF_ACTION[err.action];
  if (isNoMediaRefusal(err)) {
    if (err.code === '701' && mediaLoaded === true) {
      return { text: TRANSITION_NOT_AVAILABLE[asked] ?? TRANSITION_NOT_AVAILABLE.other };
    }
    if (NO_DLNA_MEDIA[asked]) return { text: NO_DLNA_MEDIA[asked], noMedia: true };
    return { text: TRANSITION_NOT_AVAILABLE.other };
  }
  const specific = isAvTransport(err) ? AV_TRANSPORT_MESSAGES : RENDERING_CONTROL_MESSAGES;
  return { text: specific[err.code] ?? COMMON_MESSAGES[err.code] ?? REFUSED };
}

/**
 * The error to throw to the core for `err`: a UpnpError becomes a UserError
 * (NoDlnaMediaError for a lack of media) in `language`; anything else is
 * returned unchanged.
 */
export function toUserError(err, { language, ...context } = {}) {
  if (!(err instanceof UpnpError)) return err;
  const { text, noMedia } = explainUpnpError(err, context);
  return noMedia ? new NoDlnaMediaError(text, language, err) : new UserError(text, language, err);
}
