// -----------------------------------------------------------------------------
// The Denon fixture with a scripted AVTransport / RenderingControl: the test
// changes `state` and the renderer answers accordingly; SetAVTransportURI,
// Play, Stop… change it the way a renderer does.
// -----------------------------------------------------------------------------

import { createFakeGladys } from './fakeGladys.js';
import { createFakeNetwork } from './fakeNetwork.js';
import { Registry } from '../../src/registry.js';
import { StatePublisher } from '../../src/states.js';
import { RendererManager } from '../../src/poller.js';
import { buildRendererDevice } from '../../src/devices/renderer.js';
import { buildServerDevice } from '../../src/devices/server.js';
import { normalizeConfig } from '../../src/config.js';
import { buildMetadata, parseDidl, formatDuration } from '../../src/upnp/didl.js';
import { escapeXml } from '../../src/upnp/xml.js';

const ORIGIN = 'http://192.0.2.10:60006';
export const AV = `${ORIGIN}/upnp/control/renderer_dvc/AVTransport`;
export const RC = `${ORIGIN}/upnp/control/renderer_dvc/RenderingControl`;

export function fakeTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(fn, delay) {
      const timer = { fn, delay, cleared: false };
      pending.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    last() {
      return pending.filter((timer) => !timer.cleared).at(-1);
    },
  };
}

export async function scriptedDenon({ extraDevices = [] } = {}) {
  const network = createFakeNetwork();
  const location = network.serve('denon-avr-s650h');
  const registry = new Registry({ fetchImpl: network.fetch });
  const infos = await registry.describe(location);
  const config = normalizeConfig();

  const state = {
    transport: 'STOPPED',
    uri: '',
    metadata: '',
    next: null,
    position: 0,
    duration: 0,
    volume: 11,
    muted: false,
  };

  network.onAction(AV, 'GetTransportInfo', () => ({
    CurrentTransportState: state.transport,
    CurrentTransportStatus: 'OK',
    CurrentSpeed: '1',
  }));
  network.onAction(AV, 'GetPositionInfo', () => ({
    Track: state.uri ? '1' : '0',
    TrackDuration: formatDuration(state.duration),
    TrackMetaData: state.metadata,
    TrackURI: state.uri,
    RelTime: formatDuration(state.position),
    AbsTime: 'NOT_IMPLEMENTED',
  }));
  network.onAction(AV, 'GetMediaInfo', () => ({
    NrTracks: '1',
    CurrentURI: state.uri,
    CurrentURIMetaData: state.metadata,
  }));
  network.onAction(AV, 'SetAVTransportURI', (args) => {
    state.uri = args.CurrentURI;
    state.metadata = args.CurrentURIMetaData;
    state.transport = 'STOPPED';
    state.position = 0;
    state.duration = parseDidl(args.CurrentURIMetaData).items[0]?.resources[0]?.duration ?? 0;
    return {};
  });
  network.onAction(AV, 'SetNextAVTransportURI', (args) => {
    state.next = { uri: args.NextURI, metadata: args.NextURIMetaData };
    return {};
  });
  network.onAction(AV, 'Play', () => {
    state.transport = 'PLAYING';
    return {};
  });
  network.onAction(AV, 'Pause', () => {
    state.transport = 'PAUSED_PLAYBACK';
    return {};
  });
  network.onAction(AV, 'Stop', () => {
    state.transport = 'STOPPED';
    return {};
  });
  network.onAction(RC, 'GetVolume', () => ({ CurrentVolume: String(state.volume) }));
  network.onAction(RC, 'SetVolume', (args) => {
    state.volume = Number(args.DesiredVolume);
    return {};
  });
  network.onAction(RC, 'GetMute', () => ({ CurrentMute: state.muted ? '1' : '0' }));
  network.onAction(RC, 'SetMute', (args) => {
    state.muted = args.DesiredMute === '1';
    return {};
  });

  /** The renderer moves to its preloaded next track, as a gapless one does. */
  state.advance = () => {
    state.uri = state.next.uri;
    state.metadata = state.next.metadata;
    state.next = null;
    state.position = 1;
  };
  /** Something else starts playing (the vendor app). */
  state.playForeign = (title) => {
    state.uri = 'http://other/stream';
    state.metadata = buildMetadata({ url: state.uri, title });
    state.transport = 'PLAYING';
  };

  const gladys = createFakeGladys();
  const renderer = buildRendererDevice(
    gladys,
    infos.find((info) => info.kind === 'renderer'),
    config,
  );
  const server = buildServerDevice(
    gladys,
    infos.find((info) => info.kind === 'server'),
    config,
  );
  gladys.devices.push(renderer, server, ...extraDevices);

  const timers = fakeTimers();
  let clock = 1_000_000;
  // The playback check of the renderers runs on the test clock, instantly.
  const clientOf = registry.clientOf.bind(registry);
  registry.clientOf = (info) => {
    const client = clientOf(info);
    client.now = () => clock;
    client.sleep = async (ms) => {
      clock += ms;
    };
    return client;
  };
  const displayChanges = [];
  const manager = new RendererManager({
    gladys,
    registry,
    publisher: new StatePublisher(gladys),
    onDisplayChange: (id) => displayChanges.push(id),
    timers,
    now: () => clock,
    random: () => 0,
  });
  manager.sync(gladys.devices);

  return {
    network,
    registry,
    gladys,
    manager,
    state,
    timers,
    displayChanges,
    renderer,
    server,
    id: renderer.external_id,
    feature: (key) => `${renderer.external_id}:${key}`,
    tick: (ms) => {
      clock += ms;
    },
    // escapeXml re-exported for tests building metadata by hand
    escapeXml,
  };
}
