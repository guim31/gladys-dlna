// -----------------------------------------------------------------------------
// The two device types of the integration, and the helpers that tell them
// apart from an external_id.
//
// External ids are built from the UDN of the UPnP device (its unique,
// permanent identifier), never from its name or its address: a renderer that
// changes IP or is renamed stays the same Gladys device.
// -----------------------------------------------------------------------------

export const DEVICE_KINDS = { RENDERER: 'renderer', SERVER: 'server' };

/** `{ kind, platformId }` of one of our device external_ids, or null. */
export function parseDeviceExternalId(gladys, externalId) {
  for (const kind of Object.values(DEVICE_KINDS)) {
    const prefix = gladys.externalIds(kind, '').device;
    if (typeof externalId === 'string' && externalId.startsWith(prefix)) {
      const platformId = externalId.slice(prefix.length);
      // A feature external_id is `<device>:<key>`: not a device id.
      if (platformId && !platformId.includes(':')) {
        return { kind, platformId };
      }
    }
  }
  return null;
}

/** The value of a device param, '' when absent. */
export function paramOf(device, name) {
  return device?.params?.find((param) => param.name === name)?.value ?? '';
}

export const PARAMS = {
  LOCATION: 'LOCATION',
  UDN: 'UDN',
  MANUFACTURER: 'MANUFACTURER',
  MODEL: 'MODEL',
};

/** The params every published device carries. LOCATION (the description URL)
 * is what reaches the device again after a restart; Gladys upserts it on every
 * publication, so a DHCP change heals at the next scan. */
export function deviceParams(info) {
  return [
    { name: PARAMS.LOCATION, value: info.location },
    { name: PARAMS.UDN, value: info.udn },
    { name: PARAMS.MANUFACTURER, value: info.manufacturer || '' },
    { name: PARAMS.MODEL, value: info.modelName || '' },
  ].filter((param) => param.value);
}
