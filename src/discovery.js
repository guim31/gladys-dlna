// -----------------------------------------------------------------------------
// Discovery: find the renderers and servers of the network and build the
// devices shown in the Discovery tab.
//
// The container sits on a Docker bridge: SSDP multicast never reaches it. The
// core, on the host network, sends the M-SEARCH for us (manifest
// `network_discovery`) and relays the raw answers. Only ONE ssdp entry of the
// manifest is ever scanned by the core, so the integration searches
// `upnp:rootdevice` and reads every description: renderers and servers are
// often embedded in a vendor root device, and answer nothing else reliably.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseUrlList } from './config.js';
import { locationsFromSsdp } from './upnp/description.js';
import { DEVICE_KINDS, PARAMS, paramOf, parseDeviceExternalId } from './devices/index.js';
import { buildRendererDevice } from './devices/renderer.js';
import { buildServerDevice } from './devices/server.js';
import { normalizeText } from './upnp/server.js';

const logger = createLogger({ name: 'discovery' });

export const SSDP_SCAN_SECONDS = 5;

/** The description URLs of the devices already created in Gladys. */
export function createdLocations(gladys) {
  return (gladys.devices ?? [])
    .filter((device) => parseDeviceExternalId(gladys, device.external_id))
    .map((device) => paramOf(device, PARAMS.LOCATION))
    .filter(Boolean);
}

/** The Discovery tab payload, renderers first, by name. */
export function buildDiscoveredDevices(gladys, infos, config) {
  const rendererNames = new Set(
    infos
      .filter((info) => info.kind === DEVICE_KINDS.RENDERER)
      .map((info) => normalizeText(info.name)),
  );
  return [...infos]
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === DEVICE_KINDS.RENDERER ? -1 : 1) ||
        a.name.localeCompare(b.name),
    )
    .map((info) =>
      info.kind === DEVICE_KINDS.RENDERER
        ? buildRendererDevice(gladys, info, config)
        : buildServerDevice(
            gladys,
            { ...info, sharesName: rendererNames.has(normalizeText(info.name)) },
            config,
          ),
    );
}

/**
 * Scan the network (through the core), read the descriptions of everything
 * that answered, of the URLs typed by hand and of the devices already
 * created, and resolve what was found.
 */
export async function discover({ gladys, registry, config }) {
  let answers = [];
  try {
    answers = await gladys.scanNetwork('ssdp', { timeoutSeconds: SSDP_SCAN_SECONDS });
  } catch (err) {
    // A core without mediated discovery, or a scan already running: the URLs
    // typed by hand and the created devices still work.
    logger.warn(`SSDP scan unavailable: ${err.message}`);
  }
  const locations = [
    ...locationsFromSsdp(answers),
    ...parseUrlList(config.description_urls),
    ...createdLocations(gladys),
  ];
  const infos = await registry.describeAll(locations);
  logger.info(
    `Discovery: ${answers.length} SSDP answer(s), ${locations.length} description(s), ` +
      `${infos.filter((info) => info.kind === DEVICE_KINDS.RENDERER).length} renderer(s), ` +
      `${infos.filter((info) => info.kind === DEVICE_KINDS.SERVER).length} server(s)`,
  );
  return infos;
}
