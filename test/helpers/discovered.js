// -----------------------------------------------------------------------------
// The devices the integration publishes for every fixture of the fake LAN
// (renderers and servers of several makes), found the way production finds
// them: an SSDP answer per device, then the descriptions and SCPDs.
// -----------------------------------------------------------------------------

import { createFakeGladys } from './fakeGladys.js';
import { createFakeNetwork, FIXTURE_NAMES, ssdpAnswer } from './fakeNetwork.js';
import { Registry } from '../../src/registry.js';
import { buildDiscoveredDevices, discover } from '../../src/discovery.js';
import { normalizeConfig } from '../../src/config.js';

export async function discoverFixtures({ language = 'en', names = FIXTURE_NAMES } = {}) {
  const network = createFakeNetwork();
  const locations = names.map((name) => network.serve(name));
  const gladys = createFakeGladys({ ssdp: locations.map((location) => ssdpAnswer(location)) });
  const registry = new Registry({ fetchImpl: network.fetch });
  const config = normalizeConfig({ language });
  const infos = await discover({ gladys, registry, config });
  return {
    network,
    gladys,
    registry,
    infos,
    devices: buildDiscoveredDevices(gladys, infos, config),
  };
}
