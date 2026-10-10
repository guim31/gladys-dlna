// -----------------------------------------------------------------------------
// Scene actions and triggers: the handlers match the manifest declarations,
// and they drive a renderer and a server of the fake LAN.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { serveLibrary } from './helpers/fakeLibrary.js';
import { createSceneActions, PLAY_MODES } from '../src/scenes.js';
import { SCENE_TRIGGERS } from '../src/poller.js';
import { SEARCH_BY } from '../src/upnp/server.js';
import { buildServerDevice } from '../src/devices/server.js';
import { normalizeConfig } from '../src/config.js';
import { parseDidl } from '../src/upnp/didl.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declaration = (list, key) => manifest[list].find((entry) => entry.key === key);

async function setup() {
  const denon = await scriptedDenon();
  const location = denon.network.serve('minidlna');
  serveLibrary(denon.network, 'http://192.0.2.50:8200/ctl/ContentDir');
  const [info] = await denon.registry.describe(location);
  const minidlna = buildServerDevice(denon.gladys, info, normalizeConfig());
  denon.gladys.devices.push(minidlna);
  const actions = createSceneActions({
    gladys: denon.gladys,
    registry: denon.registry,
    renderers: denon.manager,
  });
  return { ...denon, actions, minidlna: minidlna.external_id };
}

test('the select options of play_media are the values the code knows', () => {
  const fields = declaration('scene_actions', 'play_media').fields;
  const options = (key) => fields.find((field) => field.key === key).options.map((o) => o.value);
  assert.deepEqual(options('search_by'), SEARCH_BY);
  assert.deepEqual(options('mode'), PLAY_MODES);
});

test('the outputs returned are exactly the declared ones', async () => {
  const { actions, id, minidlna } = await setup();
  const outputs = await actions.play_media({
    renderer: id,
    server: minidlna,
    search_by: 'album',
    query: 'Abbey Road',
    mode: 'all',
  });
  const declared = declaration('scene_actions', 'play_media').outputs.map((output) => output.key);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort());
  assert.deepEqual(outputs, { found: true, count: 3, title: 'Come Together' });
  const urlOutputs = await actions.play_url({ renderer: id, url: 'http://radio/live.mp3' });
  assert.deepEqual(
    Object.keys(urlOutputs),
    declaration('scene_actions', 'play_url').outputs.map((output) => output.key),
  );
});

test('play_media plays an album in order on the Denon, at the asked volume', async () => {
  const { actions, id, minidlna, state, manager } = await setup();
  await actions.play_media({
    renderer: id,
    server: minidlna,
    search_by: 'album',
    query: 'abbey road',
    mode: 'all',
    volume: 20,
  });
  assert.equal(state.volume, 20);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(parseDidl(state.metadata).items[0].title, 'Come Together');
  assert.equal(manager.viewOf(id).queue.length, 3);
});

test('play_media "first" plays one track, of a folder given by its path', async () => {
  const { actions, id, minidlna, state, manager } = await setup();
  const outputs = await actions.play_media({
    renderer: id,
    server: minidlna,
    search_by: 'folder',
    query: 'Music/Jazz',
    mode: 'first',
  });
  assert.deepEqual(outputs, { found: true, count: 1, title: 'Take Five' });
  assert.equal(state.uri, 'http://192.0.2.50:8200/MediaItems/j1.mp3');
  assert.equal(manager.viewOf(id).queue.length, 1);
});

test('play_media finding nothing says so, and plays nothing', async () => {
  const { actions, id, minidlna, network } = await setup();
  const outputs = await actions.play_media({
    renderer: id,
    server: minidlna,
    search_by: 'title',
    query: 'nothing like this',
  });
  assert.deepEqual(outputs, { found: false, count: 0, title: '' });
  assert.equal(network.actions('SetAVTransportURI').length, 0);
});

test('play_media refuses a server as renderer and a renderer as server', async () => {
  const { actions, id, minidlna } = await setup();
  await assert.rejects(
    actions.play_media({ renderer: minidlna, server: minidlna, query: 'x' }),
    /Pick a DLNA renderer/,
  );
  await assert.rejects(
    actions.play_media({ renderer: id, server: id, query: 'x' }),
    /Pick a DLNA media server/,
  );
});

test('play_url plays a web radio with its title and volume', async () => {
  const { actions, id, state } = await setup();
  await actions.play_url({
    renderer: id,
    url: ' https://radio.example/fip.aac ',
    title: 'FIP',
    volume: 35,
  });
  assert.equal(state.uri, 'https://radio.example/fip.aac');
  assert.equal(parseDidl(state.metadata).items[0].title, 'FIP');
  assert.equal(state.volume, 35);
  await assert.rejects(actions.play_url({ renderer: id, url: 'file:///etc/passwd' }), /http/);
});

test('every trigger the poller fires is declared, with its filter and variables', async () => {
  const declared = manifest.scene_triggers.map((trigger) => trigger.key);
  assert.deepEqual(declared.sort(), Object.values(SCENE_TRIGGERS).sort());

  const { manager, id, state, gladys } = await setup();
  await manager.refresh(id);
  state.transport = 'PLAYING';
  await manager.refresh(id);
  const [event] = gladys.sceneEvents;
  const trigger = declaration('scene_triggers', event.key);
  for (const field of trigger.fields) {
    assert.ok(field.key in event.data, `filter ${field.key} is sent`);
  }
  for (const variable of trigger.variables) {
    assert.equal(typeof event.data[variable.key], variable.type, `variable ${variable.key}`);
  }
  assert.equal(event.data.device, id, 'the device filter is the renderer external_id');
});
