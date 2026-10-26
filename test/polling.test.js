// -----------------------------------------------------------------------------
// The renderers are published with should_poll: false and polled by the
// container's own timer: the core's scheduler never polls them (and Gladys 5.2.0
// never polls a device created without should_poll, GladysAssistant/Gladys#3198,
// even once its fix #3199 ships). Nothing may depend on onPoll.
//
// And the logs stay quiet: a normal cycle writes nothing in info, a repeated
// failure is logged once when it starts and once when it ends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys as createSdkFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeNetwork, ssdpAnswer } from './helpers/fakeNetwork.js';
import { POLL_INTERVALS_MS } from '../src/poller.js';
import { RENDERER_FEATURES } from '../src/devices/renderer.js';
import { Registry } from '../src/registry.js';
import { discover, resetDiscoveryLog } from '../src/discovery.js';
import { normalizeConfig } from '../src/config.js';
import { buildMetadata } from '../src/upnp/didl.js';
import { loggableUrl } from '../src/upnp/http.js';

/** Run the pending poll timer of the renderer, as the clock would. */
async function runTimer({ timers, manager, id }) {
  const timer = timers.last();
  assert.ok(timer, 'a poll is scheduled');
  timer.cleared = true;
  timer.fn();
  await manager.entries.get(id).running;
}

/** Capture the SDK logger lines (stdout and stderr) at the default level. */
function captureLogs(t) {
  const saved = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  t.after(() => {
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  });
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return {
    lines,
    at: (level) => lines.filter((line) => line.includes(`[${level.toUpperCase()}]`)),
  };
}

test('the container polls the renderers itself: no onPoll needed', async (t) => {
  const gladys = createSdkFakeGladys({ selector: 'dlna' });
  t.after(() => gladys.disconnect());
  const denon = await scriptedDenon({ gladys });
  const { manager, timers, feature, renderer, state } = denon;
  assert.equal(renderer.should_poll, false);
  assert.equal(renderer.poll_frequency, undefined);

  // sync() (on connection, on device creation) starts the timer at once.
  assert.equal(timers.last().delay, 0);
  await runTimer(denon);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.VOLUME)), 11);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.PLAYBACK_STATE)), 2);
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.IDLE, 'the next poll is scheduled');

  // A change on the renderer reaches Gladys through the timer alone.
  state.volume = 30;
  state.transport = 'PLAYING';
  await runTimer(denon);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.VOLUME)), 30);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.PLAYBACK_STATE)), 1);
  assert.equal(timers.last().delay, POLL_INTERVALS_MS.PLAYING);
  assert.equal(manager.entries.size, 1);
});

test('a normal cycle writes nothing in info', async (t) => {
  const logs = captureLogs(t);
  const denon = await scriptedDenon();
  const { manager, id, state } = denon;
  await runTimer(denon);
  state.transport = 'PLAYING';
  state.uri = 'http://192.0.2.50/a.mp3';
  state.metadata = buildMetadata({ url: state.uri, title: 'Song', artist: 'Band' });
  await runTimer(denon);
  state.volume = 25;
  await runTimer(denon);
  state.transport = 'PAUSED_PLAYBACK';
  await manager.refresh(id);
  state.transport = 'STOPPED';
  await manager.refresh(id);
  await manager.refresh(id);
  assert.deepEqual(logs.at('info'), []);
  assert.deepEqual(logs.at('warn'), []);
});

test('an unreachable renderer: one warning, silence, one line on return', async (t) => {
  const logs = captureLogs(t);
  const denon = await scriptedDenon();
  const { manager, id, network } = denon;
  await manager.refresh(id);
  network.setDown('http://192.0.2.10:60006');
  for (let i = 0; i < 4; i += 1) await manager.refresh(id);
  assert.equal(logs.at('warn').length, 1);
  assert.match(logs.at('warn')[0], /unreachable/);
  network.setDown('http://192.0.2.10:60006', false);
  await manager.refresh(id);
  await manager.refresh(id);
  assert.equal(logs.at('info').length, 1);
  assert.match(logs.at('info')[0], /reachable again/);
});

test('states refused by Gladys: one warning, then one line once accepted again', async (t) => {
  const logs = captureLogs(t);
  const denon = await scriptedDenon();
  const { gladys, manager, id, state } = denon;
  const publishStates = gladys.publishStates;
  gladys.publishStates = async () => {
    throw new Error('HTTP 429');
  };
  for (let i = 0; i < 4; i += 1) {
    state.volume = 20 + i; // a change on every poll: a publication on every poll
    await manager.refresh(id);
  }
  assert.equal(logs.at('warn').length, 1);
  gladys.publishStates = publishStates;
  await manager.refresh(id);
  await manager.refresh(id);
  assert.equal(logs.at('warn').length, 1);
  assert.equal(logs.at('info').length, 1);
  assert.match(logs.at('info')[0], /published again/);
});

test('repeated background scans log their summary and a missing scan once', async (t) => {
  resetDiscoveryLog();
  t.after(resetDiscoveryLog);
  const logs = captureLogs(t);
  const network = createFakeNetwork();
  const location = network.serve('denon-avr-s650h');
  const registry = new Registry({ fetchImpl: network.fetch });
  const config = normalizeConfig();
  const gladys = createFakeGladys({ ssdp: [ssdpAnswer(location)] });
  await discover({ gladys, registry, config });
  await discover({ gladys, registry, config });
  assert.equal(logs.at('info').length, 1, 'same result, one summary');

  gladys.scanNetwork = async () => {
    throw new Error('Scan not supported');
  };
  await discover({ gladys, registry, config });
  await discover({ gladys, registry, config });
  assert.equal(logs.at('warn').length, 1);

  gladys.scanNetwork = createFakeGladys({ ssdp: [ssdpAnswer(location)] }).scanNetwork;
  await discover({ gladys, registry, config });
  assert.equal(logs.at('warn').length, 1);
  assert.ok(logs.at('info').some((line) => /available again/.test(line)));
});

test('URLs are logged without credentials nor query string', () => {
  assert.equal(
    loggableUrl('http://user:secret@192.0.2.5:8000/stream.mp3?token=abc#x'),
    'http://192.0.2.5:8000/stream.mp3',
  );
  assert.equal(loggableUrl('not a url'), '(invalid URL)');
});
