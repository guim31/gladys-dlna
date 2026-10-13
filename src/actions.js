// -----------------------------------------------------------------------------
// Configuration screen actions (manifest `actions`): the resolved message is
// shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isHttpUrl, loggableUrl } from './upnp/http.js';
import { withServer } from './servers.js';
import { SearchTimeoutError } from './upnp/server.js';
import { DEVICE_KINDS } from './devices/index.js';
import { LANGUAGES, UserError } from './i18n.js';
import { MESSAGES } from './messages.js';
import { languageOf } from './playback.js';

const logger = createLogger({ name: 'actions' });

// Lines listed under the button: enough to find one's way in a library.
const MAX_LISTED = 25;
// Under the action's timeout_seconds (60 s in the manifest).
export const BROWSE_BUDGET_MS = 50000;

/** The texts of the configuration actions, for the translation tests. */
export const TEXTS = {
  SERVER: {
    en: 'media server',
    fr: 'serveur multimédia',
    de: 'Medienserver',
    es: 'servidor multimedia',
  },
  RENDERER: { en: 'renderer', fr: 'lecteur', de: 'Wiedergabegerät', es: 'reproductor' },
  VOLUME: { en: 'volume', fr: 'volume', de: 'Lautstärke', es: 'volumen' },
  MUTE: { en: 'mute', fr: 'sourdine', de: 'Stummschaltung', es: 'silencio' },
  // French puts a space before a colon.
  COLON: { en: ': ', fr: ' : ', de: ': ', es: ': ' },
  NOTHING_IN_DESCRIPTION: {
    en: 'This description holds no DLNA renderer nor media server.',
    fr: 'Cette description ne contient ni lecteur ni serveur DLNA.',
    de: 'Diese Beschreibung enthält weder ein DLNA-Wiedergabegerät noch einen Medienserver.',
    es: 'Esta descripción no contiene ningún reproductor ni servidor multimedia DLNA.',
  },
  found: (list) => ({
    en: `Found: ${list.en}. Add the URL to the configuration, then scan.`,
    fr: `Trouvé : ${list.fr}. Ajoutez l'URL à la configuration, puis lancez une recherche.`,
    de: `Gefunden: ${list.de}. Füge die URL der Konfiguration hinzu und starte dann einen Scan.`,
    es: `Encontrado: ${list.es}. Añada la URL a la configuración y luego inicie una búsqueda.`,
  }),
  BROWSE_TIMEOUT: {
    en: 'The server took too long to answer: try a deeper folder path.',
    fr: 'Le serveur a mis trop de temps à répondre : essayez un chemin de dossier plus précis.',
    de: 'Der Server hat zu lange gebraucht: Versuche einen genaueren Ordnerpfad.',
    es: 'El servidor tardó demasiado en responder: pruebe una ruta de carpeta más concreta.',
  },
  noFolder: (path) => ({
    en: `No folder "${path}" on this server.`,
    fr: `Aucun dossier « ${path} » sur ce serveur.`,
    de: `Kein Ordner „${path}“ auf diesem Server.`,
    es: `No hay ninguna carpeta «${path}» en este servidor.`,
  }),
  EMPTY_FOLDER: {
    en: 'This folder is empty.',
    fr: 'Ce dossier est vide.',
    de: 'Dieser Ordner ist leer.',
    es: 'Esta carpeta está vacía.',
  },
  more: (count) => ({
    en: `… and ${count} more`,
    fr: `… et ${count} de plus`,
    de: `… und ${count} weitere`,
    es: `… y ${count} más`,
  }),
};

const perLanguage = (build) => Object.fromEntries(LANGUAGES.map((lang) => [lang, build(lang)]));

function describeInfo(info) {
  if (info.kind === DEVICE_KINDS.SERVER) {
    return perLanguage((lang) => `${info.name} (${TEXTS.SERVER[lang]})`);
  }
  const extras = [info.hasVolume && TEXTS.VOLUME, info.hasMute && TEXTS.MUTE].filter(Boolean);
  return perLanguage((lang) => {
    const list = extras.map((text) => text[lang]).join(', ');
    return `${info.name} (${TEXTS.RENDERER[lang]}${list ? `${TEXTS.COLON[lang]}${list}` : ''})`;
  });
}

export function createActions(context) {
  const { registry } = context;
  return {
    /** Read a description URL typed by hand and tell what it holds. */
    async test_description_url(fields) {
      const url = String(fields.url ?? '').trim();
      if (!isHttpUrl(url)) {
        throw new UserError(MESSAGES.URL_SCHEME, languageOf(context));
      }
      logger.info(`Action test_description_url <- ${loggableUrl(url)}`);
      const infos = await registry.describe(url);
      if (infos.length === 0) {
        return TEXTS.NOTHING_IN_DESCRIPTION;
      }
      const found = infos.map(describeInfo);
      return TEXTS.found(perLanguage((lang) => found.map((entry) => entry[lang]).join(', ')));
    },

    /** List the content of a server folder, to write the paths of scenes. */
    async browse_server(fields) {
      const path = String(fields.path ?? '').trim();
      logger.info(`Action browse_server <- ${fields.server} "${path}"`);
      return withServer(context, fields.server, (fullServer) =>
        browse(fullServer.withDeadline(BROWSE_BUDGET_MS), path),
      ).catch((err) => {
        if (!(err instanceof SearchTimeoutError)) throw err;
        return TEXTS.BROWSE_TIMEOUT;
      });
    },
  };
}

/** The content of a server folder, as the message shown under the button. */
async function browse(server, path) {
  let containerId = '0';
  if (path) {
    const container = await server.findContainer(path.includes('/') ? path : `${path}/`);
    if (!container) {
      return TEXTS.noFolder(path);
    }
    containerId = container.id;
  }
  const { containers, items } = await server.browseChildren(containerId, { max: 500 });
  const lines = [
    ...containers.map((container) => `📁 ${container.title}`),
    ...items.map((item) => `♪ ${[item.artist, item.title].filter(Boolean).join(' — ')}`),
  ];
  if (lines.length === 0) {
    return TEXTS.EMPTY_FOLDER;
  }
  const more = lines.length - MAX_LISTED;
  const list = lines.slice(0, MAX_LISTED).join('\n');
  const tail = more > 0 ? TEXTS.more(more) : null;
  return perLanguage((lang) => (tail ? `${list}\n${tail[lang]}` : list));
}
