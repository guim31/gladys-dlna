// -----------------------------------------------------------------------------
// Renderer polling: states published once and only on change, scene triggers
// on transitions, the unreachable badge, commands, and the play queue.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { POLL_INTERVALS_MS, formatNowPlaying, shuffle } from '../src/poller.js';
import { RENDERER_FEATURES, NOTHING_PLAYING } from '../src/devices/renderer.js';
import { buildMetadata, parseDidl } from '../src/upnp/didl.js';

const item = (id, title, seconds = 200) => ({
  title,
  artist: 'Artist',
  album: 'Album',
  upnpClass: 'object.item.audioItem.musicTrack',
  albumArtUri: '',
  resources: [
    {
      uri: `http://192.0.2.50:8200/MediaItems/${id}.flac`,
      protocolInfo: 'http-get:*:audio/flac:DLNA.ORG_OP=01',
      duration: seconds,
    },
  ],
});

const statesOf = (gladys, id) =>
  gladys.published.filter((entry) => entry.featureExternalId === id).map((entry) => entry.state);

test('the first poll publishes the real Denon state once, then only changes', async () => {
  const denon = await scriptedDenon();
  const { gladys, manager, id, feature } = denon;
  await manager.refresh(id);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.PLAYBACK_STATE)), [0]);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.VOLUME)), [11]);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.NOW_PLAYING)), [
    { text: NOTHING_PLAYING },
  ]);
  assert.deepEqual(gladys.transports, [{ external_id: id, transport: 'local' }]);

  const count = gladys.published.length;
  await manager.refresh(id);
  assert.equal(gladys.published.length, count, 'nothing changed, nothing sent');

  denon.state.volume = 30;
  await manager.refresh(id);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.VOLUME)), [11, 30]);
});

test('no trigger on the first observation, one per transition after', async () => {
  const denon = await scriptedDenon();
  const { gladys, manager, id, state } = denon;
  state.transport = 'PLAYING';
  state.uri = 'http://x/a.mp3';
  state.metadata = buildMetadata({ url: state.uri, title: 'Song', artist: 'Band' });
  await manager.refresh(id);
  assert.deepEqual(gladys.sceneEvents, [], 'a restart is not a playback start');

  state.transport = 'PAUSED_PLAYBACK';
  await manager.refresh(id);
  state.transport = 'TRANSITIONING'; // not a state of its own
  await manager.refresh(id);
  state.transport = 'PLAYING';
  await manager.refresh(id);
  state.transport = 'STOPPED';
  await manager.refresh(id);

  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key),
    ['playback_paused', 'playback_started', 'playback_stopped'],
  );
  assert.deepEqual(gladys.sceneEvents[1].data, {
    device: id,
    renderer: 'Denon AVR-S650H',
    title: 'Song',
    artist: 'Band',
    album: '',
  });
  assert.deepEqual(statesOf(gladys, denon.feature(RENDERER_FEATURES.NOW_PLAYING)), [
    { text: 'Band — Song' },
  ]);
});

test('the pace follows the state: fast while playing, slow when idle or off', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, timers, network } = denon;
  await manager.refresh(id);
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.IDLE);
  state.transport = 'PLAYING';
  await manager.refresh(id);
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.PLAYING);
  network.setDown('http://192.0.2.10:60006');
  await manager.refresh(id);
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.UNREACHABLE);
});

test('an unreachable renderer: badge, not playing, no trigger, back to local on return', async () => {
  const denon = await scriptedDenon();
  const { gladys, manager, id, state, network, feature } = denon;
  state.transport = 'PLAYING';
  await manager.refresh(id);
  network.setDown('http://192.0.2.10:60006');
  await manager.refresh(id);
  await manager.refresh(id);
  assert.deepEqual(
    gladys.transports.map((entry) => entry.transport),
    ['local', 'unreachable'],
  );
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.PLAYBACK_STATE)), [1, 0]);

  network.setDown('http://192.0.2.10:60006', false);
  state.transport = 'STOPPED';
  await manager.refresh(id);
  assert.deepEqual(
    gladys.transports.map((entry) => entry.transport),
    ['local', 'unreachable', 'local'],
  );
  assert.deepEqual(gladys.sceneEvents, [], 'off and back is not a playback event');
});

test('device commands reach the renderer and poll again soon', async () => {
  const denon = await scriptedDenon();
  const { manager, id, network, state, timers } = denon;
  await manager.command(id, RENDERER_FEATURES.PLAY, 1);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.AFTER_COMMAND);
  await manager.command(id, RENDERER_FEATURES.PAUSE, 1);
  assert.equal(state.transport, 'PAUSED_PLAYBACK');
  await manager.command(id, RENDERER_FEATURES.STOP, 1);
  assert.equal(state.transport, 'STOPPED');
  await manager.command(id, RENDERER_FEATURES.VOLUME, 42);
  assert.equal(state.volume, 42);
  await manager.command(id, RENDERER_FEATURES.MUTE, 1);
  assert.equal(state.muted, true);
  await manager.command(id, RENDERER_FEATURES.MUTE, 1);
  assert.equal(state.muted, false);
  await manager.command(id, RENDERER_FEATURES.NEXT, 1);
  await manager.command(id, RENDERER_FEATURES.PREVIOUS, 1);
  assert.equal(network.actions('Next').length, 1);
  assert.equal(network.actions('Previous').length, 1);
  await assert.rejects(manager.command(id, 'unknown', 1), /Unsupported feature/);
  await assert.rejects(
    manager.command('ext:dlna:renderer:nope', RENDERER_FEATURES.PLAY, 1),
    /Unknown renderer/,
  );
});

test('the core notification action plays the text-to-speech URL', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state } = denon;
  await manager.command(id, RENDERER_FEATURES.NOTIFICATION, 'https://tts.example/abc.mp3');
  assert.equal(state.uri, 'https://tts.example/abc.mp3');
  assert.equal(state.transport, 'PLAYING');
  assert.equal(parseDidl(state.metadata).items[0].title, 'Gladys');
});

test('republish forgets what was sent and sends everything again', async () => {
  const denon = await scriptedDenon();
  const { gladys, manager, id, feature } = denon;
  await manager.refresh(id);
  await manager.republish(id);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.VOLUME)), [11, 11]);
  assert.equal(gladys.transports.length, 2);
});

test('a queue: gapless preload, then the renderer moves on by itself', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, network } = denon;
  const { track, count } = await manager.playItems(id, [
    item('a', 'A'),
    item('b', 'B'),
    item('c', 'C'),
  ]);
  assert.equal(track.title, 'A');
  assert.equal(count, 3);
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/a.flac');
  assert.equal(state.next.uri, 'http://192.0.2.50:8200/MediaItems/b.flac');
  // The server's protocolInfo (DLNA flags) is kept in the metadata.
  assert.equal(
    parseDidl(network.actions('SetAVTransportURI')[0].args.CurrentURIMetaData).items[0].resources[0]
      .protocolInfo,
    'http-get:*:audio/flac:DLNA.ORG_OP=01',
  );

  await manager.refresh(id);
  state.advance();
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).queue.index, 1);
  assert.equal(state.next.uri, 'http://192.0.2.50:8200/MediaItems/c.flac');
});

test('a queue without preload: the next track starts when the current one ends', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, gladys, tick } = denon;
  denon.network.onAction(
    'http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport',
    'SetNextAVTransportURI',
    () =>
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><detail><UPnPError><errorCode>701</errorCode><errorDescription>Not supported</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>',
  );
  await manager.playItems(id, [item('a', 'A', 200), item('b', 'B', 200)]);
  await manager.refresh(id);
  state.position = 195;
  await manager.refresh(id);
  tick(3000);
  state.transport = 'STOPPED'; // the track ended
  await manager.refresh(id);
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/b.flac');
  assert.equal(state.transport, 'PLAYING');
  assert.equal(manager.viewOf(id).queue.index, 1);
  assert.ok(
    !gladys.sceneEvents.some((event) => event.key === 'playback_stopped'),
    'the gap between two tracks is not a stop',
  );

  // The last track ends: the queue is over, and that is a real stop.
  await manager.refresh(id);
  state.position = 199;
  await manager.refresh(id);
  state.transport = 'STOPPED';
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).queue, null);
  assert.equal(gladys.sceneEvents.at(-1).key, 'playback_stopped');
});

test('a queue: a stop in the middle of a track does not skip to the next one', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state } = denon;
  await manager.playItems(id, [item('a', 'A', 200), item('b', 'B', 200)]);
  await manager.refresh(id);
  state.position = 60;
  await manager.refresh(id);
  state.transport = 'STOPPED'; // the remote control of the amplifier
  await manager.refresh(id);
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/a.flac');
  assert.equal(manager.viewOf(id).queue.index, 0);
});

test('a queue: next and previous walk the queue, and another media drops it', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, network, tick } = denon;
  await manager.playItems(id, [item('a', 'A'), item('b', 'B'), item('c', 'C')]);
  await manager.command(id, RENDERER_FEATURES.NEXT, 1);
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/b.flac');
  await manager.command(id, RENDERER_FEATURES.PREVIOUS, 1);
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/a.flac');
  assert.equal(network.actions('Next').length, 0, 'the queue, not the renderer, moves');

  tick(20000);
  state.playForeign('Vendor radio');
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).queue, null);
});

test('a shuffled queue plays the shuffled order', async () => {
  const denon = await scriptedDenon();
  const { manager, id } = denon;
  const { track } = await manager.playItems(id, [item('a', 'A'), item('b', 'B'), item('c', 'C')], {
    shuffled: true,
  });
  // random() = 0 in the tests: Fisher–Yates moves the first element last.
  assert.equal(track.title, 'B');
  assert.deepEqual(
    shuffle([1, 2, 3], () => 0),
    [2, 3, 1],
  );
});

test('playing a URL drops the queue and sets the volume first', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state } = denon;
  await manager.playItems(id, [item('a', 'A'), item('b', 'B')]);
  await manager.playUrl(id, 'http://radio/live.mp3', { title: 'Radio', volume: 25 });
  assert.equal(manager.viewOf(id).queue, null);
  assert.equal(state.volume, 25);
  assert.equal(state.uri, 'http://radio/live.mp3');
});

test('nothing playable in the results is an error', async () => {
  const denon = await scriptedDenon();
  await assert.rejects(
    denon.manager.playItems(denon.id, [{ title: 'x', resources: [] }]),
    /Nothing playable/,
  );
});

test('the widget is nudged when what it shows changes, not on every poll', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, displayChanges } = denon;
  await manager.refresh(id);
  const afterFirst = displayChanges.length;
  await manager.refresh(id);
  state.volume = 50; // the volume tile is live: no nudge
  await manager.refresh(id);
  assert.equal(displayChanges.length, afterFirst);
  state.transport = 'PLAYING';
  await manager.refresh(id);
  assert.equal(displayChanges.length, afterFirst + 1);
});

test('sync follows the created renderers only', async () => {
  const denon = await scriptedDenon();
  const { manager, id, gladys, timers } = denon;
  assert.ok(manager.viewOf(id));
  assert.equal(manager.entries.size, 1, 'the server is not polled');
  manager.sync([]);
  assert.equal(manager.viewOf(id), null);
  assert.ok(timers.pending.every((timer) => timer.cleared));
  manager.sync(gladys.devices);
  manager.stopAll();
  assert.ok(timers.pending.every((timer) => timer.cleared));
  manager.sync(gladys.devices); // resumes after a lost connection
  assert.ok(timers.last());
});

test('the now-playing text', () => {
  assert.equal(formatNowPlaying({ title: 'T', artist: 'A' }), 'A — T');
  assert.equal(formatNowPlaying({ title: 'T' }), 'T');
  assert.equal(formatNowPlaying({}), NOTHING_PLAYING);
  assert.equal(formatNowPlaying({ title: 'x'.repeat(500) }).length, 200);
});

test('a notification is acknowledged at once, the wake-up is followed after', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, network } = denon;
  const AV_URL = 'http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport';
  let presses = 0;
  network.onAction(AV_URL, 'Play', () => {
    // The first Play is lost while the amplifier wakes up.
    presses += 1;
    if (presses > 1) state.transport = 'PLAYING';
    return {};
  });
  await manager.command(id, RENDERER_FEATURES.NOTIFICATION, 'https://tts.example/abc.mp3');
  assert.equal(state.transport, 'STOPPED', 'acknowledged before the check');
  await manager.pending;
  assert.equal(state.uri, 'https://tts.example/abc.mp3');
  assert.equal(state.transport, 'PLAYING');
  assert.equal(presses, 2);
});

test('a scene URL answers once Play is accepted; a start that never comes is logged', async () => {
  const denon = await scriptedDenon();
  const { manager, id, network, state } = denon;
  let presses = 0;
  network.onAction('http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport', 'Play', () => {
    presses += 1; // accepted, ignored
    return {};
  });
  const url = 'https://radio.example/live.mp3';
  assert.equal(await manager.playUrl(id, url), url);
  assert.equal(presses, 1, 'the action did not wait');
  await manager.pending; // gives up after 75 s (test clock) without throwing
  assert.equal(state.transport, 'STOPPED');
  assert.ok(presses > 10);
});

test('a command during the follow-up of a start is never undone by it', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, network } = denon;
  let presses = 0;
  network.onAction('http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport', 'Play', () => {
    presses += 1;
    if (presses > 1) state.transport = 'PLAYING'; // the first Play is lost (wake-up)
    return {};
  });
  await manager.command(id, RENDERER_FEATURES.NOTIFICATION, 'https://tts.example/abc.mp3');
  await manager.command(id, RENDERER_FEATURES.STOP, 1); // the user changed their mind
  await manager.pending;
  assert.equal(state.transport, 'STOPPED', 'the follow-up did not press Play again');
  assert.equal(presses, 1);
});
