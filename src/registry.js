// -----------------------------------------------------------------------------
// What the integration knows about the UPnP devices of the network.
//
// A description URL (SSDP LOCATION, a URL typed by hand, the LOCATION param of
// a device already created in Gladys) is fetched, its media devices are read
// (embedded ones included), and each renderer's SCPDs tell which actions it
// really has. Clients are built lazily and dropped when a device moves.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { fetchText, loggableUrl } from './upnp/http.js';
import {
  SERVICE_TYPES,
  findService,
  mediaDevicesOf,
  parseDescription,
  parseScpd,
  platformIdOf,
} from './upnp/description.js';
import { Renderer } from './upnp/renderer.js';
import { MediaServer } from './upnp/server.js';
import { DEVICE_KINDS } from './devices/index.js';

const logger = createLogger({ name: 'registry' });

const DESCRIPTION_TIMEOUT_MS = 4000;
const DESCRIPTION_MAX_BYTES = 512 * 1024;
const CONCURRENCY = 8;

/** Run `worker` on every item, `limit` at a time; failures resolve null. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index]);
      } catch {
        results[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export class Registry {
  constructor({ fetchImpl } = {}) {
    this.fetchImpl = fetchImpl;
    this.known = new Map(); // `${kind}:${platformId}` → info
    this.clients = new Map(); // same key → Renderer | MediaServer
  }

  async fetch(url) {
    const { ok, status, text } = await fetchText(url, {
      timeoutMs: DESCRIPTION_TIMEOUT_MS,
      maxBytes: DESCRIPTION_MAX_BYTES,
      fetchImpl: this.fetchImpl,
    });
    if (!ok) {
      throw new Error(`HTTP ${status} on ${loggableUrl(url)}`);
    }
    return text;
  }

  async readScpd(service) {
    if (!service?.scpdUrl) return null;
    try {
      return parseScpd(await this.fetch(service.scpdUrl));
    } catch (err) {
      logger.debug(`SCPD unavailable (${loggableUrl(service.scpdUrl)}): ${err.message}`);
      return null;
    }
  }

  /**
   * What a renderer can do, from its SCPDs. An SCPD that cannot be read leaves
   * its actions unknown, and unknown means "assume the standard ones": the
   * published features must not change because a request failed once.
   */
  async readCapabilities(device) {
    const renderingControl = findService(device, SERVICE_TYPES.RENDERING_CONTROL);
    const [av, rc] = await Promise.all([
      this.readScpd(findService(device, SERVICE_TYPES.AV_TRANSPORT)),
      this.readScpd(renderingControl),
    ]);
    const has = (scpd, action) => !scpd || scpd.actions.has(action);
    return {
      avActions: av?.actions,
      rcActions: rc?.actions,
      volumeRange: rc?.ranges.Volume,
      hasVolume: !!renderingControl && has(rc, 'GetVolume') && has(rc, 'SetVolume'),
      hasMute: !!renderingControl && has(rc, 'GetMute') && has(rc, 'SetMute'),
      canSeek: has(av, 'Seek'),
    };
  }

  infoOf(kind, device, location) {
    return {
      kind,
      platformId: platformIdOf(device),
      udn: device.udn,
      name: device.friendlyName || device.modelName || device.udn,
      manufacturer: device.manufacturer,
      modelName: device.modelName,
      location,
      device,
    };
  }

  remember(info) {
    const key = `${info.kind}:${info.platformId}`;
    const previous = this.known.get(key);
    if (previous && previous.location !== info.location) {
      this.clients.delete(key);
    }
    this.known.set(key, info);
    return info;
  }

  /** Fetch one description and remember its media devices. */
  async describe(location) {
    const description = parseDescription(await this.fetch(location), location);
    const { renderers, servers } = mediaDevicesOf(description);
    const infos = [];
    for (const device of renderers) {
      const info = this.infoOf(DEVICE_KINDS.RENDERER, device, location);
      info.capabilities = await this.readCapabilities(device);
      info.hasVolume = info.capabilities.hasVolume;
      info.hasMute = info.capabilities.hasMute;
      info.canSeek = info.capabilities.canSeek;
      infos.push(this.remember(info));
    }
    for (const device of servers) {
      infos.push(this.remember(this.infoOf(DEVICE_KINDS.SERVER, device, location)));
    }
    return infos;
  }

  /** Describe several locations at once; unreachable ones are skipped. */
  async describeAll(locations) {
    const unique = [...new Set(locations.filter(Boolean))];
    const results = await mapLimit(unique, CONCURRENCY, async (location) => {
      try {
        return await this.describe(location);
      } catch (err) {
        logger.debug(`Description unavailable (${loggableUrl(location)}): ${err.message}`);
        throw err;
      }
    });
    // A device announced by two locations (two interfaces) is kept once.
    const byKey = new Map();
    for (const info of results.flat().filter(Boolean)) {
      byKey.set(`${info.kind}:${info.platformId}`, info);
    }
    return [...byKey.values()];
  }

  get(kind, platformId) {
    return this.known.get(`${kind}:${platformId}`);
  }

  /**
   * The info of a device, describing `location` when the device is not known
   * yet (a device created in Gladys, after a restart). Throws when the device
   * cannot be reached there.
   */
  async locate(kind, platformId, location) {
    const known = this.get(kind, platformId);
    if (known) return known;
    if (!location) {
      throw new Error(`Unknown ${kind} ${platformId}: no description URL`);
    }
    await this.describe(location);
    const found = this.get(kind, platformId);
    if (!found) {
      throw new Error(`${kind} ${platformId} is no longer described at ${loggableUrl(location)}`);
    }
    return found;
  }

  /** Forget a device, so that the next `locate` fetches its description again. */
  forget(kind, platformId) {
    this.known.delete(`${kind}:${platformId}`);
    this.clients.delete(`${kind}:${platformId}`);
  }

  /** The UPnP client of a known device (Renderer or MediaServer), cached. */
  clientOf(info) {
    const key = `${info.kind}:${info.platformId}`;
    if (!this.clients.has(key)) {
      const options = { fetchImpl: this.fetchImpl };
      this.clients.set(
        key,
        info.kind === DEVICE_KINDS.RENDERER
          ? new Renderer(info.device, { ...options, capabilities: info.capabilities })
          : new MediaServer(info.device, options),
      );
    }
    return this.clients.get(key);
  }
}
