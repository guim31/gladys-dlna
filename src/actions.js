// -----------------------------------------------------------------------------
// Configuration screen actions (manifest `actions`): the resolved message is
// shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isHttpUrl } from './upnp/http.js';
import { withServer } from './servers.js';
import { DEVICE_KINDS } from './devices/index.js';

const logger = createLogger({ name: 'actions' });

// Lines listed under the button: enough to find one's way in a library.
const MAX_LISTED = 25;

function describeInfo(info) {
  if (info.kind === DEVICE_KINDS.SERVER) {
    return { en: `${info.name} (media server)`, fr: `${info.name} (serveur multimédia)` };
  }
  const extras = [info.hasVolume && 'volume', info.hasMute && 'mute'].filter(Boolean);
  const extrasFr = [info.hasVolume && 'volume', info.hasMute && 'sourdine'].filter(Boolean);
  return {
    en: `${info.name} (renderer${extras.length ? `: ${extras.join(', ')}` : ''})`,
    fr: `${info.name} (lecteur${extrasFr.length ? ` : ${extrasFr.join(', ')}` : ''})`,
  };
}

export function createActions(context) {
  const { registry } = context;
  return {
    /** Read a description URL typed by hand and tell what it holds. */
    async test_description_url(fields) {
      const url = String(fields.url ?? '').trim();
      if (!isHttpUrl(url)) {
        throw new Error('The URL must start with http:// or https://');
      }
      logger.info(`Action test_description_url <- ${url}`);
      const infos = await registry.describe(url);
      if (infos.length === 0) {
        return {
          en: 'This description holds no DLNA renderer nor media server.',
          fr: 'Cette description ne contient ni lecteur ni serveur DLNA.',
        };
      }
      const found = infos.map(describeInfo);
      return {
        en: `Found: ${found.map((entry) => entry.en).join(', ')}. Add the URL to the configuration, then scan.`,
        fr: `Trouvé : ${found.map((entry) => entry.fr).join(', ')}. Ajoutez l'URL à la configuration, puis lancez une recherche.`,
      };
    },

    /** List the content of a server folder, to write the paths of scenes. */
    async browse_server(fields) {
      const path = String(fields.path ?? '').trim();
      logger.info(`Action browse_server <- ${fields.server} "${path}"`);
      return withServer(context, fields.server, async (server) => {
        let containerId = '0';
        if (path) {
          const container = await server.findContainer(path.includes('/') ? path : `${path}/`);
          if (!container) {
            return {
              en: `No folder "${path}" on this server.`,
              fr: `Aucun dossier « ${path} » sur ce serveur.`,
            };
          }
          containerId = container.id;
        }
        const { containers, items } = await server.browseChildren(containerId, { max: 500 });
        const lines = [
          ...containers.map((container) => `📁 ${container.title}`),
          ...items.map((item) => `♪ ${[item.artist, item.title].filter(Boolean).join(' — ')}`),
        ];
        if (lines.length === 0) {
          return { en: 'This folder is empty.', fr: 'Ce dossier est vide.' };
        }
        const more = lines.length - MAX_LISTED;
        const list = lines.slice(0, MAX_LISTED).join('\n');
        return {
          en: `${list}${more > 0 ? `\n… and ${more} more` : ''}`,
          fr: `${list}${more > 0 ? `\n… et ${more} de plus` : ''}`,
        };
      });
    },
  };
}
