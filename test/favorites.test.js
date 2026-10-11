// -----------------------------------------------------------------------------
// Favorites: read from the numbered configuration groups, played from the
// "DLNA favorites" widget and the "Play a DLNA favorite" scene action, on the
// scripted Denon and the fake MiniDLNA library.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { serveLibrary } from './helpers/fakeLibrary.js';
import {
  DEFAULT_CONFIG,
  FAVORITE_FIELDS,
  FAVORITE_SLOTS,
  favoriteKey,
  normalizeConfig,
} from '../src/config.js';
import { favoriteOf, favoritesOf, serverOf } from '../src/favorites.js';
import { createSceneActions } from '../src/scenes.js';
import {
  FAVORITES_PER_WIDGET,
  FAVORITES_WIDGET,
  createWidgets,
  favoriteActionKey,
  shownFavorites,
} from '../src/widgets.js';
import { buildServerDevice } from '../src/devices/server.js';
import { parseDidl } from '../src/upnp/didl.js';
import { SEARCH_BY } from '../src/upnp/server.js';
import { PLAY_MODES } from '../src/playback.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const RADIO = 'http://radio.example/fip.mp3';

async function setup(values = {}) {
  const denon = await scriptedDenon();
  const location = denon.network.serve('minidlna');
  serveLibrary(denon.network, 'http://192.0.2.50:8200/ctl/ContentDir');
  const [info] = await denon.registry.describe(location);
  const minidlna = buildServerDevice(denon.gladys, info, normalizeConfig());
  denon.gladys.devices.push(minidlna);
  let config = normalizeConfig(values);
  const context = {
    gladys: denon.gladys,
    registry: denon.registry,
    renderers: denon.manager,
    config: () => config,
    language: () => config.language,
  };
  const widget = createWidgets(context)[FAVORITES_WIDGET];
  return {
    ...denon,
    minidlna,
    context,
    widget,
    actions: createSceneActions(context),
    setConfig: (next) => {
      config = normalizeConfig(next);
    },
    get: (settings = {}) =>
      widget.get({ settings: { device: denon.id, ...settings }, language: 'en', units: 'metric' }),
    press: (slot, settings = {}) =>
      widget.action({
        actionKey: favoriteActionKey(slot),
        params: {},
        settings: { device: denon.id, ...settings },
      }),
  };
}

const buttons = (content) => content.components.filter((c) => c.type === 'button');
const statusRow = (content) => content.components.find((c) => c.type === 'status')?.items[0];

test('the favorite groups of the manifest are the ones the code reads', () => {
  const keys = manifest.config_schema.map((field) => field.key);
  for (const slot of FAVORITE_SLOTS) {
    for (const field of FAVORITE_FIELDS) {
      assert.ok(keys.includes(favoriteKey(slot, field)), favoriteKey(slot, field));
    }
  }
  assert.equal(FAVORITE_SLOTS.length, 8);
  const select = (key, slot = '1') =>
    manifest.config_schema
      .find((field) => field.key === favoriteKey(slot, key))
      .options.map((option) => option.value);
  assert.deepEqual(select('search_by'), SEARCH_BY);
  assert.deepEqual(select('mode'), PLAY_MODES);
  // A config select must always hold one of its options: the server is a
  // name, never a device pick a deleted server would invalidate.
  assert.equal(
    manifest.config_schema.find((field) => field.key === favoriteKey('1', 'server')).type,
    'string',
  );
  assert.equal(DEFAULT_CONFIG.favorite_8_mode, 'all');
});

test('the favorite pickers of the widget and the scene action list the 8 slots', () => {
  const widget = manifest.widgets.find((entry) => entry.key === FAVORITES_WIDGET);
  const picker = widget.settings.find((field) => field.key === 'favorites');
  assert.equal(picker.type, 'multi_select');
  assert.deepEqual(
    picker.options.map((option) => option.value),
    FAVORITE_SLOTS,
  );
  const action = manifest.scene_actions.find((entry) => entry.key === 'play_favorite');
  const field = action.fields.find((entry) => entry.key === 'favorite');
  assert.deepEqual(
    field.options.map((option) => option.value),
    FAVORITE_SLOTS,
  );
  assert.ok(widget.action_timeout_seconds * 1000 > 50000);
});

test('a favorite is a URL or a server search, named or named after its target', () => {
  const config = normalizeConfig({
    favorite_1_name: ' FIP ',
    favorite_1_url: RADIO,
    favorite_2_url: 'https://stream.example/jazz.aac',
    favorite_3_query: 'Abbey Road',
    favorite_3_search_by: 'album',
    favorite_3_mode: 'shuffle',
    favorite_3_server: 'MiniDLNA',
    favorite_4_url: 'ftp://nope',
    favorite_5_name: 'Only a name',
    favorite_6_search_by: 'bogus',
    favorite_6_query: 'x',
  });
  assert.deepEqual(
    favoritesOf(config).map(({ slot, kind, name }) => [slot, kind, name]),
    [
      ['1', 'url', 'FIP'],
      ['2', 'url', 'stream.example'],
      ['3', 'server', 'Abbey Road'],
      ['6', 'server', 'x'],
    ],
  );
  assert.equal(favoriteOf(config, '3').by, 'album');
  assert.equal(favoriteOf(config, '3').mode, 'shuffle');
  assert.equal(favoriteOf(config, '6').by, 'any');
  assert.equal(favoriteOf(config, '7'), null);
});

test('the widget shows the picked favorites, four at most, in slot order', () => {
  const values = {};
  for (const slot of FAVORITE_SLOTS) values[favoriteKey(slot, 'url')] = `http://r/${slot}`;
  const config = normalizeConfig(values);
  assert.deepEqual(
    shownFavorites(config, []).map((f) => f.slot),
    ['1', '2', '3', '4'],
  );
  assert.deepEqual(
    shownFavorites(config, ['8', '5', '6', '7', '2']).map((f) => f.slot),
    ['2', '5', '6', '7'],
  );
  assert.deepEqual(
    shownFavorites(normalizeConfig({ favorite_2_url: 'http://r/2' }), ['1', '2']).map(
      (f) => f.slot,
    ),
    ['2'],
  );
  assert.equal(FAVORITES_PER_WIDGET, 4);
});

test('the favorites widget is valid, with one button per favorite', async () => {
  const { get, manager, id } = await setup({
    favorite_1_name: 'FIP',
    favorite_1_url: RADIO,
    favorite_2_name: 'Beatles',
    favorite_2_query: 'Abbey Road',
  });
  await manager.refresh(id);
  const content = await get();
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    buttons(content).map((b) => [b.label, b.icon, b.action.key]),
    [
      ['FIP', 'radio', 'play_1'],
      ['Beatles', 'music', 'play_2'],
    ],
  );
  assert.deepEqual(statusRow(content).value.en, 'None');

  const empty = await get({ favorites: ['7'] });
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.equal(buttons(empty).length, 0);
  assert.match(empty.components[1].text.fr, /Aucun favori/);
});

test('a URL favorite plays from the widget and shows as the current one', async () => {
  const { get, press, manager, id, state, displayChanges } = await setup({
    favorite_1_name: 'FIP',
    favorite_1_url: RADIO,
    favorite_2_url: 'http://radio.example/other.mp3',
  });
  const toast = await press('1');
  assert.deepEqual(toast, {
    en: 'Playing FIP',
    fr: 'Lecture de FIP',
    de: 'FIP wird abgespielt',
    es: 'Reproduciendo FIP',
  });
  assert.equal(state.uri, RADIO);
  assert.equal(parseDidl(state.metadata).items[0].title, 'FIP');
  assert.ok(displayChanges.includes(id));
  await manager.pending;
  await manager.refresh(id);
  const content = await get();
  assert.equal(statusRow(content).value, 'FIP');
  assert.equal(statusRow(content).icon, 'play');
  assert.deepEqual(
    buttons(content).map((b) => b.icon),
    ['check-circle', 'radio'],
  );
});

test('the favorite playing shows even without a button in this widget', async () => {
  const { get, press, manager, id } = await setup({
    favorite_1_url: RADIO,
    favorite_6_name: 'Jazz',
    favorite_6_url: 'http://radio.example/jazz.mp3',
  });
  await press('6');
  await manager.pending;
  await manager.refresh(id);
  const content = await get({ favorites: ['1'] });
  assert.equal(statusRow(content).value, 'Jazz');
  assert.deepEqual(
    buttons(content).map((b) => b.icon),
    ['radio'],
  );
});

test('the current favorite is forgotten once something else plays', async () => {
  const { press, manager, id, state, tick } = await setup({ favorite_1_url: RADIO });
  await press('1');
  await manager.pending;
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).favorite.slot, '1');
  tick(11000);
  state.playForeign('Spotify');
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).favorite, null);
});

test('a favorite whose target changed in the configuration is no longer current', async () => {
  const { get, press, manager, id, setConfig } = await setup({ favorite_1_url: RADIO });
  await press('1');
  await manager.pending;
  await manager.refresh(id);
  assert.equal(statusRow(await get()).value, 'radio.example');
  setConfig({ favorite_1_url: 'http://radio.example/new.mp3' });
  assert.equal(statusRow(await get()).value.en, 'None');
});

test('a server favorite searches the named server and plays a queue', async () => {
  const { press, get, manager, id, state, minidlna } = await setup({
    favorite_1_name: 'Beatles',
    // Part of its name, any case.
    favorite_1_server: 'minidlna',
    favorite_1_search_by: 'album',
    favorite_1_query: 'abbey road',
  });
  assert.ok(minidlna.name.toLowerCase().includes('minidlna'), minidlna.name);
  assert.deepEqual((await press('1')).en, 'Playing Beatles');
  assert.equal(parseDidl(state.metadata).items[0].title, 'Come Together');
  assert.equal(manager.viewOf(id).queue.length, 3);
  assert.equal(manager.viewOf(id).favorite.slot, '1');
  await manager.refresh(id);
  assert.equal(statusRow(await get()).value, 'Beatles');
  // The queue ends or is dropped: the favorite with it.
  manager.entries.get(id).queue = null;
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).favorite, null);
});

test('a server favorite finding nothing says so, in the user language', async () => {
  const { press } = await setup({
    favorite_1_server: 'minidlna',
    favorite_1_query: 'nothing like this',
  });
  assert.match((await press('1')).de, /nichts gefunden/);
});

test('the server of a favorite is found by its name, or is the only one', async () => {
  const { gladys, minidlna, server } = await setup();
  assert.equal(serverOf(gladys, minidlna.name), minidlna.external_id);
  assert.equal(serverOf(gladys, minidlna.name.toUpperCase()), minidlna.external_id);
  assert.throws(() => serverOf(gladys, ''), /Several DLNA media servers/);
  assert.throws(() => serverOf(gladys, 'Plex', 'es'), /No hay ningún servidor/);
  const only = { ...gladys, devices: gladys.devices.filter((d) => d !== server) };
  assert.equal(serverOf(only, ''), minidlna.external_id);
});

test('play_favorite returns its declared outputs and sets the volume', async () => {
  const { actions, id, state } = await setup({
    favorite_3_name: 'FIP',
    favorite_3_url: RADIO,
    language: 'de',
  });
  const outputs = await actions.play_favorite({ renderer: id, favorite: '3', volume: 30 });
  const declared = manifest.scene_actions
    .find((action) => action.key === 'play_favorite')
    .outputs.map((output) => output.key);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort());
  assert.deepEqual(outputs, { started: true, name: 'FIP' });
  assert.equal(state.volume, 30);
  assert.equal(state.uri, RADIO);
  // Errors in the configured language.
  await assert.rejects(
    actions.play_favorite({ renderer: id, favorite: '4' }),
    /Dieser Favorit ist nicht eingerichtet/,
  );
});

test('the favorites widget refuses a missing renderer and an unknown button', async () => {
  const { widget, minidlna } = await setup({ favorite_1_url: RADIO });
  await assert.rejects(
    widget.action({ actionKey: 'play_1', params: {}, settings: { device: minidlna.external_id } }),
    /Pick a DLNA renderer/,
  );
  const content = await widget.get({ settings: {}, language: 'en', units: 'metric' });
  assert.deepEqual(validateWidgetContent(content), []);
});
