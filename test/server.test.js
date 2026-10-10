// -----------------------------------------------------------------------------
// MediaServer: Browse paging, Search, folder paths, and the crawl used when a
// server cannot search. The minidlna fixture gives the description and its
// real search capabilities; the content is an in-memory library.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeNetwork } from './helpers/fakeNetwork.js';
import { serveLibrary } from './helpers/fakeLibrary.js';
import { Registry } from '../src/registry.js';
import { MediaServer, SearchTimeoutError } from '../src/upnp/server.js';

const CONTROL = 'http://192.0.2.50:8200/ctl/ContentDir';

async function minidlna(options) {
  const network = createFakeNetwork();
  const location = network.serve('minidlna');
  const stats = options === undefined ? null : serveLibrary(network, CONTROL, options);
  const registry = new Registry({ fetchImpl: network.fetch });
  const [info] = await registry.describe(location);
  return { network, server: registry.clientOf(info), stats };
}

test('the search capabilities of the real minidlna answer are read', async () => {
  const { server } = await minidlna();
  const caps = await server.getSearchCapabilities();
  assert.ok(caps.has('upnp:artist'));
  assert.ok(caps.has('upnp:class'));
  assert.ok(await server.canSearch('dc:title'));
});

test('Browse follows the pages until TotalMatches', async () => {
  const { server } = await minidlna({});
  const { items, containers } = await server.browseChildren('1$1$1');
  assert.equal(items.length, 3);
  assert.equal(containers.length, 0);
});

test('an album search uses Search and returns the album in track order', async () => {
  const { server, stats, network } = await minidlna({});
  const items = await server.findMedia({ by: 'album', query: 'abbey road' });
  assert.deepEqual(
    items.map((item) => item.title),
    ['Come Together', 'Something', "Octopus's Garden"],
  );
  assert.ok(stats.search > 0);
  const [{ args }] = network.actions('Search');
  assert.equal(
    args.SearchCriteria,
    'upnp:class derivedfrom "object.item" and upnp:album contains "abbey road"',
  );
});

test('an artist search prefers upnp:artist', async () => {
  const { server, network } = await minidlna({});
  const items = await server.findMedia({ by: 'artist', query: 'Miles' });
  assert.deepEqual(
    items.map((item) => item.title),
    ['So What', 'Freddie Freeloader'],
  );
  assert.match(network.actions('Search')[0].args.SearchCriteria, /upnp:artist contains "Miles"/);
});

test('"anything" searches title, artist and album, accents ignored locally', async () => {
  const { server } = await minidlna({});
  const items = await server.findMedia({ by: 'any', query: 'brubeck' });
  assert.deepEqual(items.map((item) => item.title).sort(), ['Café Society', 'Take Five']);
  const accented = await server.findMedia({ by: 'title', query: 'Cafe' });
  // The fake server is accent-sensitive like many: the crawl is not needed,
  // but the local check keeps only true matches.
  assert.ok(accented.every((item) => item.title.startsWith('Caf')));
});

test('a folder by path is walked from the root, sub-folders included', async () => {
  const { server } = await minidlna({});
  const items = await server.findMedia({ by: 'folder', query: 'Music/Albums' });
  assert.equal(items.length, 5);
  const jazz = await server.findMedia({ by: 'folder', query: 'music / JAZZ' });
  assert.deepEqual(
    jazz.map((item) => item.title),
    ['Take Five', 'Café Society'],
  );
  assert.deepEqual(await server.findMedia({ by: 'folder', query: 'Music/Nope' }), []);
});

test('a folder by name is found anywhere', async () => {
  const { server } = await minidlna({});
  const items = await server.findMedia({ by: 'folder', query: 'kind of blue' });
  assert.deepEqual(
    items.map((item) => item.title),
    ['So What', 'Freddie Freeloader'],
  );
});

test('"anything" falls back to a folder name when no item matches', async () => {
  const { server } = await minidlna({});
  const items = await server.findMedia({ by: 'any', query: 'Jazz' });
  assert.equal(items.length, 2);
});

test('a server that cannot search is crawled', async () => {
  const { server, stats } = await minidlna({ searchCaps: '' });
  const items = await server.findMedia({ by: 'artist', query: 'beatles' });
  assert.equal(items.length, 3);
  assert.equal(stats.search, 0);
  assert.ok(stats.browse > 0);
  const folder = await server.findMedia({ by: 'folder', query: 'Albums' });
  assert.equal(folder.length, 5);
});

test('a server that declares Search but fails on it is crawled too', async () => {
  const { server, network } = await minidlna({});
  network.onAction(
    CONTROL,
    'Search',
    () =>
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><detail><UPnPError><errorCode>708</errorCode><errorDescription>Bad criteria</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>',
  );
  const items = await server.findMedia({ by: 'title', query: 'take five' });
  assert.deepEqual(
    items.map((item) => item.title),
    ['Take Five'],
  );
});

test('an empty query or nothing found gives an empty list', async () => {
  const { server } = await minidlna({});
  assert.deepEqual(await server.findMedia({ by: 'title', query: '  ' }), []);
  assert.deepEqual(await server.findMedia({ by: 'title', query: 'zzz' }), []);
});

test('a quote in a search is escaped in the criteria', async () => {
  const { server, network } = await minidlna({});
  await server.findMedia({ by: 'title', query: 'Octopus\'s "Garden"' });
  assert.match(
    network.actions('Search')[0].args.SearchCriteria,
    /contains "Octopus's \\"Garden\\""/,
  );
});

test('a deadline stops a long crawl cleanly, with a clear error', async () => {
  const network = createFakeNetwork();
  const location = network.serve('minidlna');
  const stats = serveLibrary(network, CONTROL, { searchCaps: '' });
  let clock = 0;
  // Every request of this slow server costs 2 seconds.
  const slowFetch = async (url, init) => {
    clock += 2000;
    return network.fetch(url, init);
  };
  const registry = new Registry({ fetchImpl: network.fetch });
  const [info] = await registry.describe(location);
  const server = new MediaServer(info.device, { fetchImpl: slowFetch, now: () => clock });
  await assert.rejects(
    server.withDeadline(5000).findMedia({ by: 'artist', query: 'nobody' }),
    (err) => err instanceof SearchTimeoutError && /within 5 s/.test(err.message),
  );
  assert.ok(stats.browse <= 3, `${stats.browse} Browse after the deadline`);
  // The deadline belongs to the scoped view only.
  const items = await server.findMedia({ by: 'artist', query: 'miles' });
  assert.equal(items.length, 2);
});

test('a request cut by the deadline is reported as the deadline', async () => {
  const network = createFakeNetwork();
  const location = network.serve('minidlna');
  const registry = new Registry({ fetchImpl: network.fetch });
  const [info] = await registry.describe(location);
  let clock = 0;
  const hanging = async () => {
    clock += 10000;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const server = new MediaServer(info.device, { fetchImpl: hanging, now: () => clock });
  await assert.rejects(server.withDeadline(3000).browse('0'), SearchTimeoutError);
  await assert.rejects(server.browse('0'), /aborted/);
});
