// -----------------------------------------------------------------------------
// Renderer client, against the real answers of the Denon AVR-S650H and the
// other fixture renderers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeNetwork, soapFault } from './helpers/fakeNetwork.js';
import { Registry } from '../src/registry.js';
import { describeMedia, playbackOf, PLAYBACK } from '../src/upnp/renderer.js';
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
  await renderer.playUrl('http://radio.example/live.mp3');
  assert.equal(network.actions('Stop').length, 0);
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
