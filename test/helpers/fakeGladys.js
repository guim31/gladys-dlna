// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so that the tests can assert it: external ids (same format as the SDK),
// states, transports, scene events, widget nudges, discovered devices, and the
// raw answers of a mediated SSDP scan.
// -----------------------------------------------------------------------------

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
