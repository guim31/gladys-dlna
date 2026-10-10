// -----------------------------------------------------------------------------
// Configuration screen actions: test a description URL, browse a server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeNetwork } from './helpers/fakeNetwork.js';
import { serveLibrary } from './helpers/fakeLibrary.js';
import { Registry } from '../src/registry.js';
import { createActions } from '../src/actions.js';
import { buildServerDevice } from '../src/devices/server.js';
import { normalizeConfig } from '../src/config.js';
import { SearchTimeoutError } from '../src/upnp/server.js';

const CONTROL = 'http://192.0.2.50:8200/ctl/ContentDir';

async function setup() {
  const network = createFakeNetwork();
  const denon = network.serve('denon-avr-s650h');
  const minidlna = network.serve('minidlna');
  serveLibrary(network, CONTROL);
  const registry = new Registry({ fetchImpl: network.fetch });
  const [info] = await registry.describe(minidlna);
  const gladys = createFakeGladys();
  const server = buildServerDevice(gladys, info, normalizeConfig());
  gladys.devices.push(server);
  const actions = createActions({ gladys, registry });
  return { network, registry, actions, denon, server: server.external_id };
}

test('test_description_url tells what the Denon description holds', async () => {
  const { actions, denon } = await setup();
  const message = await actions.test_description_url({ url: denon });
  assert.match(message.en, /Denon AVR-S650H \(renderer: volume, mute\)/);
  assert.match(message.en, /Denon AVR-S650H \(media server\)/);
  assert.match(message.fr, /lecteur : volume, sourdine/);
  await assert.rejects(actions.test_description_url({ url: 'ftp://x' }), /http/);
});

test('browse_server lists the root, then a folder path', async () => {
  const { actions, server } = await setup();
  const root = await actions.browse_server({ server });
  assert.equal(root.en, '📁 Music\n📁 Video');
  const jazz = await actions.browse_server({ server, path: 'Music/Jazz' });
  assert.equal(jazz.en, '♪ Dave Brubeck — Take Five\n♪ Brubeck Quartet — Café Society');
  const music = await actions.browse_server({ server, path: 'music' });
  assert.equal(music.en, '📁 Albums\n📁 Jazz');
  const none = await actions.browse_server({ server, path: 'Nope' });
  assert.equal(none.fr, 'Aucun dossier « Nope » sur ce serveur.');
});

test('browse_server answers a clear message when the server is too slow', async () => {
  const { actions, server, registry } = await setup();
  const [info] = [...registry.known.values()];
  const client = registry.clientOf(info);
  client.withDeadline = () => ({
    findContainer: async () => {
      throw new SearchTimeoutError(50);
    },
    browseChildren: async () => {
      throw new SearchTimeoutError(50);
    },
  });
  const message = await actions.browse_server({ server });
  assert.match(message.en, /took too long/);
  assert.match(message.fr, /trop de temps/);
  assert.ok(registry.known.has(`server:${info.platformId}`), 'a slow server is not forgotten');
});
