// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so that the tests can assert it: external ids (same format as the SDK),
// states, transports, scene events, widget nudges, discovered devices, and the
// raw answers of a mediated SSDP scan.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export function createFakeGladys({ selector = 'dlna', devices = [], ssdp = [] } = {}) {
  const published = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const discovered = [];
  const scans = [];

  return {
    devices,
    published,
    transports,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    discovered,
    scans,

    externalId(suffix) {
      return `ext:${selector}:${suffix}`;
    },

    externalIds(type, platformId) {
      const device = `ext:${selector}:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.text !== undefined ? { text: s.text } : s.state,
        });
      }
      return { success: true };
    },

    // Gladys 5.3: the SDK's publishNowPlaying, simplified (no position
    // extrapolation): the changed values become states, strings as text,
    // `artwork_url` as the key of artworkKey. The real one is exercised by
    // the tests on the SDK's fake Gladys (test/music.test.js).
    nowPlaying: new Map(),
    artworkUrls: new Map(),
    artworkKey(url) {
      const key = `art-${createHash('sha1').update(String(url)).digest('hex').slice(0, 12)}`;
      this.artworkUrls.set(key, url);
      return key;
    },
    async publishNowPlaying(deviceExternalId, values, { featureExternalIds = {} } = {}) {
      const previous = this.nowPlaying.get(deviceExternalId) ?? {};
      const next = { ...previous };
      let count = 0;
      for (const [key, raw] of Object.entries(values)) {
        if (raw === undefined) continue;
        const type = key === 'artwork_url' ? 'artwork' : key;
        const value = key === 'artwork_url' ? (raw ? this.artworkKey(raw) : '') : raw;
        if (previous[type] === value) continue;
        next[type] = value;
        count += 1;
        published.push({
          featureExternalId: featureExternalIds[type] ?? `${deviceExternalId}:${type}`,
          state: typeof value === 'string' ? { text: value } : value,
        });
      }
      this.nowPlaying.set(deviceExternalId, next);
      return { success: true, count };
    },
    forgetPublishedStates(externalId) {
      if (externalId === undefined) this.nowPlaying.clear();
      else this.nowPlaying.delete(externalId);
    },

    async publishTransports(entries) {
      transports.push(...entries);
      return { success: true };
    },

    async publishDiscoveredDevices(list) {
      discovered.push(list);
      return { success: true };
    },

    async scanNetwork(type, options = {}) {
      scans.push({ type, options });
      return ssdp;
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      sceneEvents.push({ key, data });
      return { success: true };
    },

    // Fire-and-forget in the SDK too: synchronous, resolves nothing.
    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },
  };
}
