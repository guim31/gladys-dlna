// -----------------------------------------------------------------------------
// Reach a media server created in Gladys, for the scene and configuration
// actions. Servers are not polled: their description is read on first use,
// and read again after a failure (the server may have moved).
// -----------------------------------------------------------------------------

import { DEVICE_KINDS, PARAMS, paramOf, parseDeviceExternalId } from './devices/index.js';

export async function withServer({ gladys, registry }, externalId, work) {
  const parsed = parseDeviceExternalId(gladys, externalId);
  if (parsed?.kind !== DEVICE_KINDS.SERVER) {
    throw new Error('Pick a DLNA media server');
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
    registry.forget(DEVICE_KINDS.SERVER, parsed.platformId);
    throw err;
  }
}

export function isRenderer(gladys, externalId) {
  return parseDeviceExternalId(gladys, externalId)?.kind === DEVICE_KINDS.RENDERER;
}
