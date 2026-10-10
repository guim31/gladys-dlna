// -----------------------------------------------------------------------------
// Device type: MEDIA SERVER (Plex, Jellyfin, Emby, minidlna, a NAS…).
//
// A server has no state worth a feature: it becomes a Gladys device so that
// the scene actions and the configuration actions can offer it in their device
// list (`"source": "devices"`, the only dynamic list the core provides).
// -----------------------------------------------------------------------------

import { DEVICE_KINDS, deviceParams } from './index.js';

const SERVER_SUFFIX = { en: ' (media server)', fr: ' (serveur multimédia)' };

/**
 * The discovery payload of a server.
 * @param {object} info `{ platformId, name, location, udn, manufacturer, modelName, sharesName }`
 *   `sharesName` is true when a renderer of the same name exists (a Denon
 *   amplifier or a Kodi box embed both): the server is then suffixed.
 */
export function buildServerDevice(gladys, info, config) {
  const ids = gladys.externalIds(DEVICE_KINDS.SERVER, info.platformId);
  const suffix = info.sharesName ? (SERVER_SUFFIX[config.language] ?? SERVER_SUFFIX.en) : '';
  return {
    name: `${info.name}${suffix}`,
    external_id: ids.device,
    should_poll: false,
    params: deviceParams(info),
    features: [],
  };
}
