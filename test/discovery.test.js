// -----------------------------------------------------------------------------
// Discovery: SSDP answers relayed by the core, URLs typed by hand, devices
// already created, and the Discovery tab payload.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeNetwork, readFixture, ssdpAnswer } from './helpers/fakeNetwork.js';
import { discoverFixtures } from './helpers/discovered.js';
import { Registry } from '../src/registry.js';
import { buildDiscoveredDevices, createdLocations, discover } from '../src/discovery.js';
import { normalizeConfig } from '../src/config.js';

test('one SSDP scan through the core, upnp:rootdevice, 5 seconds', async () => {
  const { gladys } = await discoverFixtures({ names: ['denon-avr-s650h'] });
  assert.deepEqual(gladys.scans, [{ type: 'ssdp', options: { timeoutSeconds: 5 } }]);
});

test('the Denon gives a renderer and a suffixed media server', async () => {
  const { devices } = await discoverFixtures({ names: ['denon-avr-s650h'] });
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Denon AVR-S650H', 'Denon AVR-S650H (media server)'],
  );
  const [renderer, server] = devices;
  assert.equal(renderer.external_id, 'ext:dlna:renderer:00000000-0000-4000-8000-000000000002');
  assert.equal(server.external_id, 'ext:dlna:server:00000000-0000-4000-8000-000000000005');
  assert.deepEqual(server.features, []);
  assert.equal(
    renderer.params.find((param) => param.name === 'LOCATION').value,
    'http://192.0.2.10:60006/upnp/desc/aios_device/aios_device.xml',
  );
});

test('feature names follow the configured language', async () => {
  const { devices } = await discoverFixtures({ names: ['denon-avr-s650h'], language: 'fr' });
  assert.ok(devices[0].features.some((feature) => feature.name === 'Sourdine'));
  assert.equal(devices[1].name, 'Denon AVR-S650H (serveur multimédia)');
});

test('the features follow what the renderer declares (no mute on the speaker)', async () => {
  const { devices } = await discoverFixtures({ names: ['synthetic-renderer'] });
  const keys = devices[0].features.map((feature) => feature.external_id.split(':').pop());
  assert.ok(keys.includes('volume'));
  assert.ok(!keys.includes('mute'));
});

test('a renderer whose SCPDs cannot be read keeps the standard features', async () => {
  const network = createFakeNetwork();
  const location = network.serve('aup-dmr');
  const gladys = createFakeGladys({ ssdp: [ssdpAnswer(location)] });
  const registry = new Registry({
    fetchImpl: async (url, init) =>
      url.endsWith('_1.xml') ? new Response('', { status: 500 }) : network.fetch(url, init),
  });
  const infos = await discover({ gladys, registry, config: normalizeConfig() });
  const [device] = buildDiscoveredDevices(gladys, infos, normalizeConfig());
  const keys = device.features.map((feature) => feature.external_id.split(':').pop());
  assert.ok(keys.includes('volume') && keys.includes('mute'));
});

test('URLs typed by hand and created devices are read even when SSDP finds nothing', async () => {
  const network = createFakeNetwork();
  const minidlna = network.serve('minidlna');
  const samsung = network.serve('samsung-tv');
  const gladys = createFakeGladys({
    devices: [
      {
        external_id: 'ext:dlna:renderer:00000000-0000-4000-8000-0000000000a1',
        params: [{ name: 'LOCATION', value: samsung }],
      },
      { external_id: 'ext:other:thing', params: [{ name: 'LOCATION', value: 'http://nope/' }] },
    ],
  });
  assert.deepEqual(createdLocations(gladys), [samsung]);
  const registry = new Registry({ fetchImpl: network.fetch });
  const infos = await discover({
    gladys,
    registry,
    config: normalizeConfig({ description_urls: `${minidlna}, not-a-url` }),
  });
  assert.deepEqual(infos.map((info) => info.name).sort(), [
    '[TV] Samsung Q60 Series (55)',
    'nas: minidlna',
  ]);
});

test('a failed SSDP scan or a dead description does not fail the discovery', async () => {
  const network = createFakeNetwork();
  const plex = network.serve('plex');
  network.setDown('http://192.0.2.99');
  const gladys = createFakeGladys({
    ssdp: [ssdpAnswer('http://192.0.2.99/desc.xml'), ssdpAnswer(plex)],
  });
  const registry = new Registry({ fetchImpl: network.fetch });
  const infos = await discover({ gladys, registry, config: normalizeConfig() });
  assert.deepEqual(
    infos.map((info) => info.name),
    ['Plex Media Server: nas'],
  );

  gladys.scanNetwork = async () => {
    throw new Error('403 network_discovery not declared');
  };
  const none = await discover({ gladys, registry, config: normalizeConfig() });
  assert.deepEqual(none, []);
});

test('a device announced twice (two interfaces) is published once', async () => {
  const network = createFakeNetwork();
  const location = network.serve('aup-dms');
  // The same description served on a second address.
  network.file('http://192.0.2.31:1234/device.xml', readFixture('aup-dms', 'device.xml'));
  const gladys = createFakeGladys({
    ssdp: [ssdpAnswer(location), ssdpAnswer('http://192.0.2.31:1234/device.xml')],
  });
  const registry = new Registry({ fetchImpl: network.fetch });
  const infos = await discover({ gladys, registry, config: normalizeConfig() });
  assert.equal(infos.length, 1);
});
