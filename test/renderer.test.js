// -----------------------------------------------------------------------------
// Renderer client, against the real answers of the Denon AVR-S650H and the
// other fixture renderers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeNetwork, soapFault } from './helpers/fakeNetwork.js';
import { Registry } from '../src/registry.js';
import {
  PlaybackNotStartedError,
  describeMedia,
  playbackOf,
  PLAYBACK,
} from '../src/upnp/renderer.js';
import { parseDidl } from '../src/upnp/didl.js';

const DENON_AV = 'http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport';
const DENON_RC = 'http://192.0.2.10:60006/upnp/control/renderer_dvc/RenderingControl';

async function rendererOf(name) {
  const network = createFakeNetwork();
  const location = network.serve(name);
  const registry = new Registry({ fetchImpl: network.fetch });
  const infos = await registry.describe(location);
  const info = infos.find((candidate) => candidate.kind === 'renderer');
  return { network, renderer: registry.clientOf(info), info };
}

test('the Denon status, from its real answers: stopped, volume 11 %, not muted', async () => {
  const { renderer } = await rendererOf('denon-avr-s650h');
  const status = await renderer.getStatus();
  assert.equal(status.transportState, 'STOPPED');
  assert.equal(status.playback, PLAYBACK.STOPPED);
  assert.equal(status.volume, 11);
  assert.equal(status.muted, false);
  assert.equal(status.title, '');
  assert.equal(status.uri, '');
});

test('the Denon capabilities come from its SCPDs', async () => {
  const { info, renderer } = await rendererOf('denon-avr-s650h');
  assert.equal(info.hasVolume, true);
  assert.equal(info.hasMute, true);
  assert.equal(renderer.canPreload, true);
  assert.deepEqual(renderer.volumeRange, { minimum: 0, maximum: 100 });
});

test('the transport state maps to the logical playback state', () => {
  assert.equal(playbackOf('PLAYING'), PLAYBACK.PLAYING);
  assert.equal(playbackOf('PAUSED_PLAYBACK'), PLAYBACK.PAUSED);
  assert.equal(playbackOf('NO_MEDIA_PRESENT'), PLAYBACK.STOPPED);
  assert.equal(playbackOf('TRANSITIONING'), null);
});

test('a web radio described only in the media metadata still has a title', () => {
  const media = describeMedia(
    { TrackMetaData: '', TrackURI: '' },
    {
      CurrentURI: 'http://radio/stream',
      CurrentURIMetaData:
        '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"><item><dc:title>FIP</dc:title></item></DIDL-Lite>',
    },
  );
  assert.deepEqual(media, {
    title: 'FIP',
    artist: '',
    album: '',
    albumArtUri: null,
    uri: 'http://radio/stream',
  });
});

test('the volume is a percentage of the declared range (0-60 speaker)', async () => {
  const { network, renderer } = await rendererOf('synthetic-renderer');
  network.onAction('http://192.0.2.42:8080/rc/control', 'GetVolume', () => ({
    CurrentVolume: '30',
  }));
  assert.equal(await renderer.getVolume(), 50);
  await renderer.setVolume(100);
  await renderer.setVolume(25);
  assert.deepEqual(
    network.actions('SetVolume').map((call) => call.args.DesiredVolume),
    ['60', '15'],
  );
});

test('without Pause in its SCPD, pause stops', async () => {
  const { network, renderer } = await rendererOf('synthetic-renderer');
  await renderer.pause();
  assert.equal(network.actions('Pause').length, 0);
  assert.equal(network.actions('Stop').length, 1);
});

test('a renderer without mute does not ask for it', async () => {
  const { network, renderer } = await rendererOf('synthetic-renderer');
  network.onAction('http://192.0.2.42:8080/av/control', 'GetTransportInfo', () => ({
    CurrentTransportState: 'PLAYING',
  }));
  const status = await renderer.getStatus();
  assert.equal(status.muted, null);
  assert.equal(network.actions('GetMute').length, 0);
});

test('playUrl stops a playing renderer, sets the URI with metadata, then plays', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  network.onAction(DENON_AV, 'GetTransportInfo', () => ({ CurrentTransportState: 'PLAYING' }));
  await renderer.playUrl('http://radio.example/live.aac', { title: 'Radio & co', verify: false });
  const actions = network.calls.map((call) => call.action);
  assert.deepEqual(actions, ['GetTransportInfo', 'Stop', 'SetAVTransportURI', 'Play']);
  const set = network.actions('SetAVTransportURI')[0].args;
  assert.equal(set.InstanceID, '0');
  assert.equal(set.CurrentURI, 'http://radio.example/live.aac');
  const [item] = parseDidl(set.CurrentURIMetaData).items;
  assert.equal(item.title, 'Radio & co');
  assert.equal(item.resources[0].protocolInfo, 'http-get:*:audio/aac:*');
  assert.equal(network.actions('Play')[0].args.Speed, '1');
});

test('playUrl does not stop a stopped renderer', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  await renderer.playUrl('http://radio.example/live.mp3', { verify: false });
  assert.equal(network.actions('Stop').length, 0);
});

/**
 * The Denon as measured from standby: it accepts SetAVTransportURI and Play,
 * answers an empty transport state while it wakes up (`wakeMs`), and the
 * Play sent meanwhile is lost; it then sits STOPPED with the URI loaded. A
 * playback can also be cut once, `dropAfterMs` after it started.
 */
async function standbyRenderer({
  wakeMs = 0,
  ignoresPlayUntilMs = 0,
  dropAfterMs = null,
  plays = true,
  forgetsUri = false,
} = {}) {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  let clock = 0;
  renderer.now = () => clock;
  renderer.sleep = async (ms) => {
    clock += ms;
  };
  const state = {
    uri: '',
    transport: 'STOPPED',
    playingAt: null,
    drops: dropAfterMs === null ? 0 : 1,
  };
  const awake = () => clock >= wakeMs;
  let woken = false;
  const update = () => {
    if (awake() && !woken) {
      woken = true;
      if (forgetsUri) state.uri = ''; // the source switch unloaded it
    }
    if (
      state.transport === 'PLAYING' &&
      state.drops > 0 &&
      clock - state.playingAt >= dropAfterMs
    ) {
      state.transport = 'STOPPED';
      state.drops -= 1;
    }
  };
  network.onAction(DENON_AV, 'GetTransportInfo', () => {
    update();
    return { CurrentTransportState: awake() ? state.transport : '' };
  });
  network.onAction(DENON_AV, 'GetMediaInfo', () => ({ CurrentURI: awake() ? state.uri : '' }));
  network.onAction(DENON_AV, 'SetAVTransportURI', (args) => {
    state.uri = args.CurrentURI;
    state.transport = 'STOPPED';
    return {};
  });
  network.onAction(DENON_AV, 'Play', () => {
    update();
    if (awake() && plays && state.uri && clock >= ignoresPlayUntilMs) {
      state.transport = 'PLAYING';
      state.playingAt = clock;
    }
    return {};
  });
  return { network, renderer, state, clock: () => clock };
}

const URL = 'https://icecast.radiofrance.fr/fip-midfi.mp3';

test('a renderer already on plays at once, https included, with one Play', async () => {
  const { network, renderer, state } = await standbyRenderer();
  assert.equal(await renderer.playUrl(URL, { title: 'FIP' }), URL);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(network.actions('Play').length, 1);
  assert.deepEqual(
    network.actions('SetAVTransportURI').map((call) => call.args.CurrentURI),
    [URL],
    'the https URL is kept as it is',
  );
});

test('the measured Denon wake-up: empty, then Play ignored ~40 s, then it plays', async () => {
  const { network, renderer, state, clock } = await standbyRenderer({
    wakeMs: 12000,
    ignoresPlayUntilMs: 51000,
  });
  assert.equal(await renderer.playUrl(URL), URL);
  assert.equal(state.transport, 'PLAYING');
  const presses = network.actions('Play').length;
  assert.ok(presses >= 8, `Play pressed ${presses} times, every 5 s while STOPPED`);
  assert.equal(network.actions('SetAVTransportURI').length, 1, 'the URI was still loaded');
  assert.ok(clock() <= 75000, `${clock()} ms`);
});

test('a URI unloaded by the wake-up is loaded again', async () => {
  const { network, renderer, state } = await standbyRenderer({ wakeMs: 8000, forgetsUri: true });
  await renderer.playUrl(URL);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(network.actions('SetAVTransportURI').length, 2);
});

test('a playback cut right after it started is restarted once', async () => {
  const { network, renderer, state } = await standbyRenderer({ dropAfterMs: 3000 });
  await renderer.playUrl(URL);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(network.actions('Play').length, 2);
});

test('a renderer that never plays ends with a clear error, within the time limit', async () => {
  const { network, renderer, clock } = await standbyRenderer({ wakeMs: 10000, plays: false });
  await assert.rejects(
    renderer.playUrl(URL),
    (err) => err instanceof PlaybackNotStartedError && /within 75 s/.test(err.message),
  );
  assert.ok(network.actions('Play').length >= 10, 'pressed again all along, no cap');
  assert.ok(clock() <= 76000, `${clock()} ms`);
});

test('a playback that is still running at the time limit counts as started', async () => {
  const { renderer } = await standbyRenderer({ wakeMs: 70000 });
  assert.equal(await renderer.playUrl(URL), URL);
});

test('the Denon empty artist and album ("") read as empty', () => {
  const metadata =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item><dc:title>fip-midfi.mp3</dc:title><upnp:artist>""</upnp:artist>' +
    '<upnp:album> "" </upnp:album><dc:creator>\'\'</dc:creator></item></DIDL-Lite>';
  const media = describeMedia({ TrackMetaData: metadata, TrackURI: 'http://x' }, {});
  assert.deepEqual(media, {
    title: 'fip-midfi.mp3',
    artist: '',
    album: '',
    albumArtUri: null,
    uri: 'http://x',
  });
});

test('a refused action throws with the UPnP error', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  network.onAction(DENON_AV, 'Play', () => soapFault(701, 'Transition not available'));
  await assert.rejects(renderer.play(), /701 Transition not available/);
});

test('mute toggles on the master channel', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  await renderer.setMute(true);
  assert.deepEqual(network.actions('SetMute')[0].args, {
    InstanceID: '0',
    Channel: 'Master',
    DesiredMute: '1',
  });
  network.onAction(DENON_RC, 'GetMute', () => ({ CurrentMute: 'true' }));
  assert.equal(await renderer.getMute(), true);
});

test('the sink of the Denon is read once', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  const sink = await renderer.getSink();
  await renderer.getSink();
  assert.ok(sink.includes('http-get:*:audio/flac:*'));
  assert.equal(network.actions('GetProtocolInfo').length, 1);
});

test('an unreachable renderer throws on its status', async () => {
  const { network, renderer } = await rendererOf('samsung-tv');
  network.setDown('http://192.0.2.40:9197');
  await assert.rejects(renderer.getStatus());
});
