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
  httpVariant,
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
  assert.deepEqual(media, { title: 'FIP', artist: '', album: '', uri: 'http://radio/stream' });
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
  await renderer.playUrl('http://radio.example/live.aac', { title: 'Radio & co' });
  const actions = network.calls.map((call) => call.action);
  // Then the playback check: already PLAYING.
  assert.deepEqual(actions, [
    'GetTransportInfo',
    'Stop',
    'SetAVTransportURI',
    'Play',
    'GetTransportInfo',
  ]);
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

/** A renderer that, like the real Denon, accepts https URLs but only plays http. */
async function httpOnlyRenderer({ playsHttp = true } = {}) {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  const state = { uri: '', transport: 'STOPPED' };
  network.onAction(DENON_AV, 'GetTransportInfo', () => ({
    CurrentTransportState: state.transport,
  }));
  network.onAction(DENON_AV, 'SetAVTransportURI', (args) => {
    state.uri = args.CurrentURI;
    state.transport = 'STOPPED';
    return {};
  });
  network.onAction(DENON_AV, 'Play', () => {
    // Accepted (200) in every case; only an http stream really starts.
    if (playsHttp && state.uri.startsWith('http:')) state.transport = 'PLAYING';
    return {};
  });
  renderer.playWait = { timeoutMs: 2000, intervalMs: 500 };
  const waits = [];
  renderer.sleep = async (ms) => {
    waits.push(ms);
  };
  return { network, renderer, state, waits };
}

test('an https stream that does not start is retried once in http', async () => {
  const { network, renderer, state, waits } = await httpOnlyRenderer();
  const played = await renderer.playUrl('https://icecast.radiofrance.fr/fip-midfi.mp3', {
    title: 'FIP',
  });
  assert.equal(played, 'http://icecast.radiofrance.fr/fip-midfi.mp3');
  assert.equal(state.transport, 'PLAYING');
  const uris = network.actions('SetAVTransportURI').map((call) => call.args.CurrentURI);
  assert.deepEqual(uris, [
    'https://icecast.radiofrance.fr/fip-midfi.mp3',
    'http://icecast.radiofrance.fr/fip-midfi.mp3',
  ]);
  // The metadata follows the URL actually played.
  const [item] = parseDidl(network.actions('SetAVTransportURI')[1].args.CurrentURIMetaData).items;
  assert.equal(item.resources[0].uri, 'http://icecast.radiofrance.fr/fip-midfi.mp3');
  assert.equal(item.title, 'FIP');
  assert.equal(waits.length, 4, 'the https attempt was given its whole time');
});

test('a URL that never plays ends with a clear error', async () => {
  const https = await httpOnlyRenderer({ playsHttp: false });
  await assert.rejects(
    https.renderer.playUrl('https://radio.example/live.mp3'),
    (err) => err instanceof PlaybackNotStartedError && /may not accept https/.test(err.message),
  );
  assert.equal(https.network.actions('SetAVTransportURI').length, 2);

  const http = await httpOnlyRenderer({ playsHttp: false });
  await assert.rejects(
    http.renderer.playUrl('http://radio.example/live.ogg'),
    /did not start playing this URL/,
  );
  assert.equal(http.network.actions('SetAVTransportURI').length, 1, 'no retry for http');
});

test('a renderer that starts after a while is waited for', async () => {
  const { network, renderer } = await rendererOf('denon-avr-s650h');
  const answers = ['STOPPED', 'TRANSITIONING', 'TRANSITIONING', 'PLAYING'];
  network.onAction(DENON_AV, 'GetTransportInfo', () => ({
    CurrentTransportState: answers.shift() ?? 'PLAYING',
  }));
  renderer.sleep = async () => {};
  assert.equal(
    await renderer.playUrl('https://radio.example/live.mp3'),
    'https://radio.example/live.mp3',
  );
  assert.equal(network.actions('SetAVTransportURI').length, 1);
});

test('httpVariant', () => {
  assert.equal(httpVariant('https://h.example/a?b=1'), 'http://h.example/a?b=1');
  assert.equal(httpVariant('https://h.example:443/a'), 'http://h.example/a');
  assert.equal(httpVariant('https://h.example:8443/a'), 'http://h.example:8443/a');
  assert.equal(httpVariant('http://h.example/a'), null);
  assert.equal(httpVariant('nope'), null);
});

test('the Denon empty artist and album ("") read as empty', () => {
  const metadata =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item><dc:title>fip-midfi.mp3</dc:title><upnp:artist>""</upnp:artist>' +
    '<upnp:album> "" </upnp:album><dc:creator>\'\'</dc:creator></item></DIDL-Lite>';
  const media = describeMedia({ TrackMetaData: metadata, TrackURI: 'http://x' }, {});
  assert.deepEqual(media, { title: 'fip-midfi.mp3', artist: '', album: '', uri: 'http://x' });
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
