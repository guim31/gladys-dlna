// -----------------------------------------------------------------------------
// The "DLNA player" widget: every content is valid for the core (nothing it
// would drop, truncate or trim), the live tile points to a published feature,
// and every button is handled.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { createWidgets, playerContent, PLAYER_WIDGET, refreshWidgets } from '../src/widgets.js';
import { buildMetadata } from '../src/upnp/didl.js';

async function setup() {
  const denon = await scriptedDenon();
  const widgets = createWidgets({ gladys: denon.gladys, renderers: denon.manager });
  const widget = widgets[PLAYER_WIDGET];
  const get = (device = denon.id) =>
    widget.get({ settings: { device }, language: 'en', units: 'metric' });
  const act = (actionKey, device = denon.id) =>
    widget.action({ actionKey, params: {}, settings: { device } });
  return { ...denon, widgets, widget, get, act };
}

test('every content state is rendered exactly as sent', async () => {
  const { get, manager, id, state, network, server } = await setup();
  assert.deepEqual(validateWidgetContent(await get()), [], 'not polled yet');
  assert.deepEqual(validateWidgetContent(await get(undefined)), [], 'no renderer chosen');
  assert.deepEqual(validateWidgetContent(await get(server.external_id)), [], 'a server chosen');

  state.transport = 'PLAYING';
  state.uri = 'http://x/a.mp3';
  state.metadata = buildMetadata({
    url: state.uri,
    title: 'A very long title that will never fit in the forty characters',
    artist: 'Artist',
    album: 'An album whose name is far too long for a status row',
  });
  state.muted = true;
  await manager.refresh(id);
  const playing = await get();
  assert.deepEqual(validateWidgetContent(playing), []);
  assert.ok(playing.components.some((c) => c.type === 'button' && c.label.en === 'Pause'));

  network.setDown('http://192.0.2.10:60006');
  await manager.refresh(id);
  const off = await get();
  assert.deepEqual(validateWidgetContent(off), []);
  assert.match(off.components[1].text.en, /Unreachable/);
});

test('a queue shows its position', () => {
  const content = playerContent('ext:dlna:renderer:x', {
    name: 'Speaker',
    reachable: true,
    status: { playback: 'playing', title: 'T', artist: '', album: '', muted: null },
    queue: { index: 1, length: 12 },
    hasVolume: false,
    hasMute: false,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((row) => row.value === '2 / 12'));
  assert.equal(content.components.filter((c) => c.type === 'button').length, 2);
});

test('the live volume tile points to a feature the renderer publishes', async () => {
  const { get, manager, id, renderer } = await setup();
  await manager.refresh(id);
  const features = new Set(renderer.features.map((feature) => feature.external_id));
  const live = (await get()).components.filter((c) => c.device_feature);
  assert.equal(live.length, 1);
  for (const tile of live) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
  }
});

test('every button is handled and answers a short toast', async () => {
  const { get, act, manager, id, state } = await setup();
  await manager.refresh(id);
  const buttons = (await get()).components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 4);
  for (const { action } of buttons) {
    const toast = await act(action.key);
    assert.ok(toast.en && toast.en.length <= 200 && toast.fr);
  }
  // play, stop, -5, +5 from 11
  assert.equal(state.transport, 'STOPPED');
  assert.equal(state.volume, 11);
});

test('toggle plays then pauses, volume steps are bounded', async () => {
  const { act, manager, id, state } = await setup();
  await manager.refresh(id);
  assert.deepEqual(await act('toggle'), { en: 'Playing', fr: 'Lecture' });
  await manager.refresh(id);
  assert.deepEqual(await act('toggle'), { en: 'Paused', fr: 'En pause' });
  assert.equal(state.transport, 'PAUSED_PLAYBACK');
  state.volume = 98;
  await manager.refresh(id);
  assert.deepEqual(await act('volume_up'), { en: 'Volume 100%', fr: 'Volume 100 %' });
});

test('an unknown action or no renderer fails, so the user sees it', async () => {
  const { act, server } = await setup();
  await assert.rejects(act('unknown'), /Unknown widget action/);
  await assert.rejects(act('toggle', server.external_id), /Pick a DLNA renderer/);
});

test('refreshWidgets nudges every widget', async () => {
  const { gladys, widgets } = await setup();
  refreshWidgets(gladys, widgets);
  assert.deepEqual(gladys.widgetRefreshes, Object.keys(widgets));
});
