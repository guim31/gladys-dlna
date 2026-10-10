// -----------------------------------------------------------------------------
// Device and service descriptions (UPnP Device Architecture 1.0, section 2),
// and the SSDP search answers that point to them.
// -----------------------------------------------------------------------------

import { child, childText, children, parseXml } from './xml.js';
import { isHttpUrl } from './http.js';

export const DEVICE_TYPES = {
  RENDERER: 'urn:schemas-upnp-org:device:MediaRenderer:',
  SERVER: 'urn:schemas-upnp-org:device:MediaServer:',
};

export const SERVICE_TYPES = {
  AV_TRANSPORT: 'urn:schemas-upnp-org:service:AVTransport:',
  RENDERING_CONTROL: 'urn:schemas-upnp-org:service:RenderingControl:',
  CONNECTION_MANAGER: 'urn:schemas-upnp-org:service:ConnectionManager:',
  CONTENT_DIRECTORY: 'urn:schemas-upnp-org:service:ContentDirectory:',
};

/**
 * Parse the raw text of an SSDP answer (an HTTP response without a body) into
 * lowercased headers. Returns null when it is not an HTTP answer.
 */
export function parseSsdpHeaders(raw) {
  const lines = String(raw ?? '').split(/\r?\n/);
  if (!/^HTTP\/1\.[01]\s+200/i.test(lines[0] ?? '') && !/^NOTIFY\s/i.test(lines[0] ?? '')) {
    return null;
  }
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return headers;
}

/**
 * The description URLs announced by a list of raw SSDP results
 * (`gladys.scanNetwork('ssdp')`), deduplicated, http(s) only.
 */
export function locationsFromSsdp(results = []) {
  const locations = new Set();
  for (const result of results) {
    const headers = parseSsdpHeaders(result?.headers);
    if (headers?.location && isHttpUrl(headers.location)) {
      locations.add(headers.location);
    }
  }
  return [...locations];
}

function resolveUrl(value, base) {
  if (!value) return undefined;
  try {
    return new URL(value, base).href;
  } catch {
    return undefined;
  }
}

function parseDevice(node, base) {
  const services = children(child(node, 'serviceList'), 'service').map((service) => ({
    serviceType: childText(service, 'serviceType'),
    serviceId: childText(service, 'serviceId'),
    controlUrl: resolveUrl(childText(service, 'controlURL'), base),
    scpdUrl: resolveUrl(childText(service, 'SCPDURL'), base),
  }));
  return {
    deviceType: childText(node, 'deviceType'),
    udn: childText(node, 'UDN'),
    friendlyName: childText(node, 'friendlyName'),
    manufacturer: childText(node, 'manufacturer'),
    modelName: childText(node, 'modelName'),
    modelNumber: childText(node, 'modelNumber'),
    services,
    devices: children(child(node, 'deviceList'), 'device').map((sub) => parseDevice(sub, base)),
  };
}

/**
 * Parse a device description. Relative URLs are resolved against `URLBase`
 * when present (UDA 1.0), else against the description location itself.
 */
export function parseDescription(xml, location) {
  const root = parseXml(xml);
  if (root.name !== 'root') {
    throw new Error('Not a UPnP device description');
  }
  const base = resolveUrl(childText(root, 'URLBase'), location) ?? location;
  const device = child(root, 'device');
  if (!device) {
    throw new Error('The description declares no device');
  }
  return { location, root: parseDevice(device, base) };
}

/** Every device of a description, the root and its embedded devices. */
export function allDevices(description) {
  const list = [];
  const walk = (device) => {
    list.push(device);
    device.devices.forEach(walk);
  };
  walk(description.root);
  return list;
}

/** The first service of a device whose type starts with `typePrefix`. */
export function findService(device, typePrefix) {
  return device.services.find((service) => service.serviceType.startsWith(typePrefix));
}

/**
 * The stable identifier of a device: its UDN without the `uuid:` prefix,
 * lowercased. It survives IP changes, reboots and firmware updates.
 */
export function platformIdOf(device) {
  return (
    device.udn
      .replace(/^uuid:/i, '')
      .trim()
      .toLowerCase()
      // An external id segment never holds a colon (it separates the features).
      .replace(/[^a-z0-9._-]/g, '_')
  );
}

/**
 * The media devices of a description: renderers holding an AVTransport and
 * servers holding a ContentDirectory, wherever they sit in the tree (a
 * MediaRenderer is often embedded in a vendor root device).
 */
export function mediaDevicesOf(description) {
  const renderers = [];
  const servers = [];
  for (const device of allDevices(description)) {
    if (!device.udn) continue;
    if (
      device.deviceType.startsWith(DEVICE_TYPES.RENDERER) &&
      findService(device, SERVICE_TYPES.AV_TRANSPORT)?.controlUrl
    ) {
      renderers.push(device);
    } else if (
      device.deviceType.startsWith(DEVICE_TYPES.SERVER) &&
      findService(device, SERVICE_TYPES.CONTENT_DIRECTORY)?.controlUrl
    ) {
      servers.push(device);
    }
  }
  return { renderers, servers };
}

/**
 * Parse a service description (SCPD): the action names, and the allowed range
 * of the state variables that declare one.
 */
export function parseScpd(xml) {
  const root = parseXml(xml);
  const actions = new Set(
    children(child(root, 'actionList'), 'action')
      .map((action) => childText(action, 'name'))
      .filter(Boolean),
  );
  const ranges = {};
  for (const variable of children(child(root, 'serviceStateTable'), 'stateVariable')) {
    const range = child(variable, 'allowedValueRange');
    if (range) {
      const minimum = Number(childText(range, 'minimum'));
      const maximum = Number(childText(range, 'maximum'));
      if (Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum) {
        ranges[childText(variable, 'name')] = { minimum, maximum };
      }
    }
  }
  return { actions, ranges };
}
