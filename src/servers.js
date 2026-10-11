// -----------------------------------------------------------------------------
// Reach a media server created in Gladys, for the scene and configuration
// actions. Servers are not polled: their description is read on first use,
// and read again after a failure (the server may have moved).
// -----------------------------------------------------------------------------

import { DEVICE_KINDS, PARAMS, paramOf, parseDeviceExternalId } from './devices/index.js';
import { SearchTimeoutError } from './upnp/server.js';
import { UserError } from './i18n.js';
import { MESSAGES } from './messages.js';

export async function withServer({ gladys, registry, language }, externalId, work) {
  const parsed = parseDeviceExternalId(gladys, externalId);
  if (parsed?.kind !== DEVICE_KINDS.SERVER) {
    throw new UserError(MESSAGES.PICK_SERVER, language?.() ?? 'en');
  }
  const device = (gladys.devices ?? []).find((candidate) => candidate.external_id === externalId);
  const info = await registry.locate(
    DEVICE_KINDS.SERVER,
    parsed.platformId,
    paramOf(device, PARAMS.LOCATION),
  );
  try {
    return await work(registry.clientOf(info), info);
  } catch (err) {
    // A slow search says nothing about the server's address; any other
    // failure may: read its description again next time.
    if (!(err instanceof SearchTimeoutError)) {
      registry.forget(DEVICE_KINDS.SERVER, parsed.platformId);
    }
    throw err;
  }
}

export function isRenderer(gladys, externalId) {
  return parseDeviceExternalId(gladys, externalId)?.kind === DEVICE_KINDS.RENDERER;
}
