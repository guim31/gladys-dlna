// -----------------------------------------------------------------------------
// Entry point of the DLNA integration: SDK wiring only. Handlers are
// registered before connect(); the UPnP work lives in src/.
//
// Environment variables provided by the Gladys supervisor (read by the SDK):
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { DEVICE_KINDS, parseDeviceExternalId } from './src/devices/index.js';
import { rendererFeatureKey } from './src/devices/renderer.js';
import { Registry } from './src/registry.js';
import { StatePublisher } from './src/states.js';
import { RendererManager } from './src/poller.js';
import { buildDiscoveredDevices, discover } from './src/discovery.js';
import { createActions } from './src/actions.js';
import { createSceneActions } from './src/scenes.js';
import { createWidgets, refreshWidgets } from './src/widgets.js';
import { MESSAGES } from './src/messages.js';

// A renderer that went silent may have moved (DHCP, a new port after a
// reboot): a background scan relocates it, at most this often.
const RELOCATION_INTERVAL_MS = 5 * 60 * 1000;

const gladys = new GladysIntegration();
let config = normalizeConfig();

const registry = new Registry();
const publisher = new StatePublisher(gladys);
let widgets = {};
const renderers = new RendererManager({
  gladys,
  registry,
  publisher,
  onDisplayChange: () => refreshWidgets(gladys, widgets),
  onUnreachable: () => relocate(),
  language: () => config.language,
});
const context = {
  gladys,
  registry,
  renderers,
  config: () => config,
  language: () => config.language,
};
widgets = createWidgets(context);

// --- Discovery -----------------------------------------------------------------
// One discovery at a time: the core runs one network scan per integration.
let discovery = null;
function runDiscovery() {
  if (!discovery) {
    discovery = (async () => {
      const infos = await discover({ gladys, registry, config });
      await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, infos, config));
    })().finally(() => {
      discovery = null;
    });
  }
  return discovery;
}

let lastRelocation = 0;
function relocate() {
  if (Date.now() - lastRelocation < RELOCATION_INTERVAL_MS) return;
  lastRelocation = Date.now();
  runDiscovery().catch((err) => logger.warn('Background discovery failed', err));
}

gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> searching DLNA devices');
  await runDiscovery();
});

// --- Commands --------------------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id}`);
  if (parseDeviceExternalId(gladys, device.external_id)?.kind !== DEVICE_KINDS.RENDERER) {
    throw new Error(`No command on ${device.external_id}`);
  }
  await renderers.command(
    device.external_id,
    rendererFeatureKey(device.external_id, feature.external_id),
    value,
  );
});

// The devices are published with should_poll: false (the container polls at
// its own pace); a poll asked by the core anyway just refreshes now.
gladys.onPoll(async (device) => {
  await renderers.refresh(device.external_id);
});

// --- Device lifecycle ------------------------------------------------------------
// The core drops the states received before a feature exists: everything is
// published again once the user added the device.
gladys.onDeviceCreated(async (device) => {
  renderers.sync(gladys.devices);
  if (parseDeviceExternalId(gladys, device.external_id)?.kind === DEVICE_KINDS.RENDERER) {
    await renderers.republish(device.external_id);
  }
  refreshWidgets(gladys, widgets);
});

gladys.onDeviceUpdated(async () => {
  renderers.sync(gladys.devices);
});

gladys.onDeviceDeleted(async (device) => {
  renderers.sync(gladys.devices);
  publisher.forget(device.external_id);
});

// --- Manifest actions, scene actions, widgets ------------------------------------
for (const [key, handler] of Object.entries(createActions(context))) {
  gladys.onAction(key, (fields) => handler(fields));
}

for (const [key, handler] of Object.entries(createSceneActions(context))) {
  gladys.onSceneAction(key, (fields) => handler(fields));
}

for (const [key, widget] of Object.entries(widgets)) {
  gladys.onWidgetGet(key, (request) => widget.get(request));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action({ actionKey, params, settings }),
  );
}

// --- Configuration -----------------------------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // The favorites widgets show the names of the configuration.
  refreshWidgets(gladys, widgets);
  await runDiscovery();
});

// --- Connection lifecycle ----------------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    renderers.sync(gladys.devices);
    await gladys.setConnectionStatus(true);
    // Nudges sent while the socket was down were dropped.
    refreshWidgets(gladys, widgets);
    // Fill the Discovery tab without waiting for the user to ask.
    runDiscovery().catch((err) => logger.warn('Startup discovery failed', err));
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys.setConnectionStatus(false, MESSAGES.INIT_FAILED).catch(() => {});
  }
});

gladys.on('disconnected', () => {
  renderers.stopAll();
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  renderers.stopAll();
});

logger.info('Starting the DLNA integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
