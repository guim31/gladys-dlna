// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the device model, what publishNowPlaying
// receives, the commands (playback state, seek, shuffle, repeat, mute), the
// queue of the integration, and the catalog of the media servers (browse,
// search, play, queue, artwork), on the scripted Denon and an in-memory
// ContentDirectory. The SDK's fake Gladys checks what the core would see.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys as createSdkFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateMediaItems } from '@gladysassistant/integration-sdk';
import { AV, scriptedDenon } from './helpers/scriptedRenderer.js';
import { defaultLibrary, folder, serveLibrary, track } from './helpers/fakeLibrary.js';
import { soapFault } from './helpers/fakeNetwork.js';
import { buildServerDevice } from '../src/devices/server.js';
import { RENDERER_FEATURES, buildRendererDevice } from '../src/devices/renderer.js';
import { normalizeConfig } from '../src/config.js';
import { createCatalog, mediaId, parseMediaId, KIND, MAX_ID } from '../src/catalog.js';
import { buildMetadata, parseDidl, pickArtwork } from '../src/upnp/didl.js';
import {
  MAX_QUEUE,
  followingIndex,
  playbackStateOf,
  titleOfUri,
  POLL_INTERVALS_MS,
} from '../src/poller.js';
import { PLAYBACK } from '../src/upnp/renderer.js';

const MANIFEST = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const CONTROL = 'http://192.0.2.50:8200/ctl/ContentDir';
const ART = (name) => `http://192.0.2.50:8200/AlbumArt/${name}.jpg`;

const statesOf = (gladys, id) =>
  gladys.published.filter((entry) => entry.featureExternalId === id).map((entry) => entry.state);

/** A library with a music album view (album class, album art, a cover picture). */
function library() {
  return [
    ...defaultLibrary(),
    folder('1$3', '1', 'By album'),
    {
      kind: 'container',
      id: '1$3$1',
      parentId: '1$3',
      title: 'Abbey Road',
      artist: 'The Beatles',
      upnpClass: 'object.container.album.musicAlbum',
      albumArts: [
        { uri: ART('big'), profile: '' },
        { uri: ART('tn'), profile: 'JPEG_TN' },
      ],
    },
    // Server order is not album order.
    { ...track('a2', '1$3$1', 'Something', 'The Beatles', 'Abbey Road', 2) },
    {
      ...track('a1', '1$3$1', 'Come Together', 'The Beatles', 'Abbey Road', 1),
      albumArts: [{ uri: ART('a1'), profile: 'JPEG_TN' }],
    },
    {
      kind: 'item',
      id: 'a-cover',
      parentId: '1$3$1',
      title: 'cover',
      upnpClass: 'object.item.imageItem.photo',
      res: { uri: 'http://192.0.2.50:8200/MediaItems/cover.jpg', mime: 'image/jpeg', duration: '' },
    },
  ];
}

/**
 * The scripted Denon (renderer) with one media server added to Gladys, the
 * in-memory minidlna, and the catalog. `sdk`: on the SDK's fake Gladys.
 */
async function setup({ objects = library(), searchCaps, sdk = false, t } = {}) {
  const sdkGladys = sdk ? createSdkFakeGladys({ selector: 'dlna' }) : undefined;
  if (sdkGladys) t.after(() => sdkGladys.disconnect());
  const denon = await scriptedDenon({ gladys: sdkGladys });
  const devices = sdk ? denon.gladys.fake.devices : denon.gladys.devices;
  // Only the minidlna server in Gladys (the Denon embeds one too).
  devices.splice(devices.indexOf(denon.server), 1);
  const location = denon.network.serve('minidlna');
  serveLibrary(denon.network, CONTROL, { objects, searchCaps, pageSize: 50 });
  const [info] = await denon.registry.describe(location);
  const minidlna = buildServerDevice(denon.gladys, info, normalizeConfig());
  devices.push(minidlna);
  // The SDK read its devices at connect(): as Gladys would send them now.
  if (sdk) denon.gladys.devices = [...devices];
  denon.network.onAction(AV, 'Seek', (args) => {
    denon.state.seeks = [...(denon.state.seeks ?? []), args];
    return {};
  });
  const catalog = createCatalog({
    gladys: denon.gladys,
    registry: denon.registry,
    renderers: denon.manager,
    language: () => 'en',
  });
  const device = { external_id: denon.id, params: [] };
  return { ...denon, catalog, device, minidlna, platformId: info.platformId };
}

const ids = (items) => items.map((item) => item.title);

// --- Device model ----------------------------------------------------------------

test('the manifest declares the music operations and Gladys 5.3', () => {
  assert.deepEqual(MANIFEST.music, { browse: true, search: true, queue: true, append: true });
  assert.equal(MANIFEST.gladys_version, '>=5.3.0');
});

test('a renderer: the 5.3 music features, the 1.x ids kept', async () => {
  const { renderer, id } = await scriptedDenon();
  const byKey = Object.fromEntries(
    renderer.features.map((feature) => [feature.external_id.slice(id.length + 1), feature]),
  );
  // 1.x ids: same external id, converted by "Update" in the Discovery tab.
  assert.equal(byKey['playback-state'].type, 'playback_state');
  assert.equal(byKey['playback-state'].read_only, false);
  assert.equal(byKey['playback-state'].has_feedback, true);
  assert.equal(byKey['playback-state'].max, 2);
  assert.equal(byKey.mute.category, 'music');
  assert.equal(byKey.mute.type, 'mute');
  assert.equal(byKey['now-playing'].category, 'text');
  assert.equal(byKey.stop.category, 'television');
  // 5.3: the default ids of publishNowPlaying (`<device>:<type>`).
  for (const type of ['title', 'artist', 'album', 'artwork', 'duration']) {
    assert.equal(byKey[type].type, type);
    assert.equal(byKey[type].read_only, true);
  }
  for (const type of ['position', 'shuffle', 'repeat', 'volume']) {
    assert.equal(byKey[type].read_only, false, type);
    assert.equal(byKey[type].has_feedback, true, type);
  }
  assert.equal(byKey.position.unit, 'seconds');
  assert.equal(byKey.repeat.max, 2);
  // Push buttons have no state to confirm.
  assert.equal(byKey.play.has_feedback, false);
});

test('a renderer without Seek in its SCPD publishes a read-only position', async () => {
  const { gladys } = await scriptedDenon();
  const device = buildRendererDevice(
    gladys,
    { platformId: 'x', name: 'X', location: 'http://192.0.2.9/', canSeek: false },
    normalizeConfig(),
  );
  const position = device.features.find((feature) => feature.type === 'position');
  assert.equal(position.read_only, true);
  assert.equal(position.has_feedback, false);
});

test('small helpers: playback state, following index, title of a URL, artwork pick', () => {
  assert.equal(playbackStateOf({ playback: PLAYBACK.PLAYING }), 1);
  assert.equal(playbackStateOf({ playback: PLAYBACK.PAUSED }), 0);
  assert.equal(playbackStateOf({ playback: PLAYBACK.STOPPED }), 2);
  assert.equal(playbackStateOf({ transportState: 'TRANSITIONING', playback: null }), 3);
  assert.equal(playbackStateOf({ playback: null }), null);

  const queue = { tracks: [1, 2, 3], index: 2 };
  assert.equal(followingIndex(queue, 0), -1);
  assert.equal(followingIndex(queue, 1), 0);
  assert.equal(followingIndex(queue, 2), 2);
  assert.equal(followingIndex({ tracks: [1, 2], index: 0 }, 0), 1);

  assert.equal(titleOfUri('http://192.0.2.5/music/Caf%C3%A9%20Society.flac'), 'Café Society');
  assert.equal(titleOfUri('http://radio.example/'), 'radio.example');
  assert.equal(titleOfUri('not a url'), '');

  const [object] = parseDidl(
    '<DIDL-Lite xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/"><item id="1">' +
      '<upnp:albumArtURI dlna:profileID="JPEG_TN">http://s/tn.jpg</upnp:albumArtURI>' +
      '<upnp:albumArtURI>http://s/full.jpg</upnp:albumArtURI>' +
      '<upnp:albumArtURI dlna:profileID="JPEG_SM">http://s/sm.jpg</upnp:albumArtURI>' +
      '<upnp:albumArtURI>/relative.jpg</upnp:albumArtURI></item></DIDL-Lite>',
  ).items;
  assert.equal(pickArtwork(object, 'player'), 'http://s/sm.jpg');
  assert.equal(pickArtwork(object, 'list'), 'http://s/tn.jpg');
  assert.equal(pickArtwork({ albumArts: [{ uri: '/relative.jpg', profile: '' }] }), null);
  assert.equal(pickArtwork(undefined), null);
});

// --- Now playing --------------------------------------------------------------------

test('now playing on the SDK fake: idle clears, a track is one batch, unchanged is not sent', async (t) => {
  const { gladys, manager, id, feature, state } = await setup({ sdk: true, t });
  const last = (key) => gladys.fake.lastState(feature(key));
  await manager.refresh(id);
  assert.equal(last(RENDERER_FEATURES.PLAYBACK_STATE), 2);
  assert.equal(last(RENDERER_FEATURES.TITLE), '');
  assert.equal(last(RENDERER_FEATURES.ARTWORK), '');
  assert.equal(last(RENDERER_FEATURES.VOLUME), 11);
  assert.equal(last(RENDERER_FEATURES.MUTE), 0);
  assert.equal(last(RENDERER_FEATURES.SHUFFLE), 0);
  assert.equal(last(RENDERER_FEATURES.REPEAT), 0);

  state.uri = 'http://192.0.2.50:8200/MediaItems/t1.mp3';
  state.metadata = buildMetadata({
    url: state.uri,
    title: 'Come Together',
    artist: 'The Beatles',
    album: 'Abbey Road',
    albumArtUri: ART('t1'),
    duration: 259,
  });
  state.duration = 259;
  state.position = 12;
  state.transport = 'PLAYING';
  await manager.refresh(id);
  assert.equal(last(RENDERER_FEATURES.PLAYBACK_STATE), 1);
  assert.equal(last(RENDERER_FEATURES.TITLE), 'Come Together');
  assert.equal(last(RENDERER_FEATURES.ARTIST), 'The Beatles');
  assert.equal(last(RENDERER_FEATURES.ALBUM), 'Abbey Road');
  assert.equal(last(RENDERER_FEATURES.DURATION), 259);
  assert.equal(last(RENDERER_FEATURES.POSITION), 12);
  const key = last(RENDERER_FEATURES.ARTWORK);
  assert.match(key, /^art-[0-9a-f]{12}$/);
  assert.equal(gladys.artworkUrls.get(key), ART('t1'));

  const count = gladys.fake.requests.length;
  await manager.refresh(id);
  assert.equal(gladys.fake.requests.length, count, 'nothing changed, nothing sent');

  state.transport = 'TRANSITIONING';
  await manager.refresh(id);
  assert.equal(last(RENDERER_FEATURES.PLAYBACK_STATE), 3);
});

test('now playing: a frozen position is not published again, the queue fills the gaps', async () => {
  const { manager, id, tick, catalog, device, platformId } = await setup();
  const entry = manager.entries.get(id);
  const status = {
    transportState: 'PLAYING',
    playback: PLAYBACK.PLAYING,
    uri: 'http://x/a.mp3',
    title: 'A',
    artist: '',
    album: '',
    albumArtUri: null,
    position: 0,
    duration: null,
    volume: null,
    muted: null,
  };
  assert.equal(manager.nowPlayingOf(entry, status).position, 0);
  tick(5000);
  assert.equal('position' in manager.nowPlayingOf(entry, status), false, 'frozen at 0');
  assert.equal(manager.nowPlayingOf(entry, { ...status, position: 5 }).position, 5);
  // A position beyond a day is not sent (the feature's max).
  assert.equal('position' in manager.nowPlayingOf(entry, { ...status, position: 90000 }), false);
  // Stopped with the media loaded: IDLE, the media stays, position 0.
  const stopped = manager.nowPlayingOf(entry, { ...status, playback: PLAYBACK.STOPPED });
  assert.equal(stopped.playback_state, 2);
  assert.equal(stopped.title, 'A');
  assert.equal(stopped.position, 0);
  // Nothing loaded: every text cleared explicitly.
  const empty = manager.nowPlayingOf(entry, {
    ...status,
    transportState: 'NO_MEDIA_PRESENT',
    playback: PLAYBACK.STOPPED,
  });
  assert.deepEqual(
    [empty.title, empty.artist, empty.album, empty.artwork_url, empty.duration],
    ['', '', '', null, 0],
  );

  // A queue track tells what a renderer without metadata does not.
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  const current = entry.queue.tracks[0];
  const bare = manager.nowPlayingOf(entry, { ...status, uri: current.uri, title: '' });
  assert.equal(bare.title, 'Come Together');
  assert.equal(bare.album, 'Abbey Road');
  assert.equal(bare.artwork_url, ART('a1'));
  assert.equal(bare.duration, 210);
});

test('an unreachable renderer is IDLE with nothing loaded', async (t) => {
  const { gladys, manager, id, feature, state, network } = await setup({ sdk: true, t });
  state.transport = 'PLAYING';
  state.uri = 'http://x/a.mp3';
  state.metadata = buildMetadata({ url: state.uri, title: 'Song' });
  await manager.refresh(id);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.TITLE)), 'Song');
  network.setDown('http://192.0.2.10:60006');
  await manager.refresh(id);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.PLAYBACK_STATE)), 2);
  assert.equal(gladys.fake.lastState(feature(RENDERER_FEATURES.TITLE)), '');
});

// --- Commands -----------------------------------------------------------------------

test('the playback state is the command: 0 pause, 1 play, 2 stop, 3 refused', async () => {
  const { manager, id, state } = await setup();
  state.uri = 'http://x/a.mp3';
  await manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 1);
  assert.equal(state.transport, 'PLAYING');
  await manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 0);
  assert.equal(state.transport, 'PAUSED_PLAYBACK');
  await manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 2);
  assert.equal(state.transport, 'STOPPED');
  await assert.rejects(
    manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 3),
    /Unknown playback state/,
  );
});

test('play on a queue whose renderer lost its media starts the current track again', async () => {
  const { manager, id, state, catalog, device, platformId, network } = await setup();
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  state.transport = 'NO_MEDIA_PRESENT';
  state.uri = '';
  await manager.refresh(id);
  const loads = network.actions('SetAVTransportURI').length;
  await manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 1);
  assert.equal(network.actions('SetAVTransportURI').length, loads + 1);
  assert.match(state.uri, /a1\.mp3$/);
  assert.equal(state.transport, 'PLAYING');

  // upmpdcli: STOPPED with an empty URI after a Stop.
  state.transport = 'STOPPED';
  state.uri = '';
  await manager.refresh(id);
  await manager.command(id, RENDERER_FEATURES.PLAYBACK_STATE, 1);
  assert.equal(network.actions('SetAVTransportURI').length, loads + 2);
  assert.equal(state.transport, 'PLAYING');
});

test('a position is a seek (REL_TIME, ABS_TIME when refused), refused without Seek', async () => {
  const { manager, id, state, network, registry } = await setup();
  await manager.command(id, RENDERER_FEATURES.POSITION, 65);
  assert.deepEqual(state.seeks.at(-1), { InstanceID: '0', Unit: 'REL_TIME', Target: '0:01:05' });

  network.onAction(AV, 'Seek', (args) => {
    state.seeks.push(args);
    return args.Unit === 'REL_TIME' ? soapFault('710', 'Seek mode not supported') : {};
  });
  await manager.command(id, RENDERER_FEATURES.POSITION, 3);
  assert.deepEqual(
    state.seeks.slice(-2).map((args) => args.Unit),
    ['REL_TIME', 'ABS_TIME'],
  );

  const entry = manager.entries.get(id);
  const client = await manager.rendererOf(entry);
  client.capabilities = { ...client.capabilities, avActions: new Set(['Play', 'Stop']) };
  await assert.rejects(manager.command(id, RENDERER_FEATURES.POSITION, 3), /cannot move/);
  assert.ok(registry);
});

test('shuffle reorders what is left of the queue and puts it back; modes are published', async () => {
  const { manager, id, catalog, device, platformId, gladys, feature, state } = await setup();
  const folderId = mediaId(KIND.CONTAINER, platformId, '1$1$1', 'Abbey Road');
  // A folder is not played whole from the panel, but a scene id may hold one.
  await catalog.play(device, { id: folderId, type: 'folder' }, 'replace');
  const entry = manager.entries.get(id);
  const order = () => entry.queue.tracks.map((one) => one.title);
  assert.deepEqual(order(), ['Something', 'Come Together', "Octopus's Garden"]);
  assert.match(state.next.uri, /t1\.mp3$/, 'the next track is preloaded');

  // random() = 0: Fisher-Yates moves each one down.
  await manager.command(id, RENDERER_FEATURES.SHUFFLE, 1);
  assert.deepEqual(order(), ['Something', "Octopus's Garden", 'Come Together']);
  assert.match(state.next.uri, /t4\.mp3$/, 'the new next track is preloaded');
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.SHUFFLE)).at(-1), 1);
  await manager.command(id, RENDERER_FEATURES.SHUFFLE, 0);
  assert.deepEqual(order(), ['Something', 'Come Together', "Octopus's Garden"]);
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.SHUFFLE)).at(-1), 0);

  // The player's shuffle applies to the next queue too.
  await manager.command(id, RENDERER_FEATURES.SHUFFLE, 1);
  await catalog.play(device, { id: folderId, type: 'folder' }, 'replace');
  assert.notDeepEqual(order(), ['Something', 'Come Together', "Octopus's Garden"]);
  await manager.command(id, RENDERER_FEATURES.SHUFFLE, 0);
  assert.deepEqual(
    order().slice(1).sort(),
    ['Come Together', "Octopus's Garden", 'Something'].filter((t) => t !== order()[0]).sort(),
  );

  await assert.rejects(manager.command(id, RENDERER_FEATURES.REPEAT, 7), /Unknown repeat mode/);
});

/** Play the current track to its end (as the renderer would), then poll. */
async function endTrack({ manager, id, state, tick }) {
  state.transport = 'PLAYING';
  state.position = state.duration - 1;
  await manager.refresh(id);
  tick(5000);
  state.transport = 'STOPPED';
  state.next = null;
  await manager.refresh(id);
}

test('repeat one starts the track again; repeat all goes back to the first one', async () => {
  const setupResult = await setup();
  const { manager, id, catalog, device, platformId, state, gladys, feature } = setupResult;
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  const entry = manager.entries.get(id);
  assert.match(state.next.uri, /a2\.mp3$/);

  await manager.command(id, RENDERER_FEATURES.REPEAT, 2);
  assert.equal(state.next.uri, '', 'the preloaded track is taken back');
  assert.deepEqual(statesOf(gladys, feature(RENDERER_FEATURES.REPEAT)).at(-1), 2);
  await endTrack(setupResult);
  assert.equal(entry.queue.index, 0);
  assert.match(state.uri, /a1\.mp3$/, 'the same track again');

  await manager.command(id, RENDERER_FEATURES.REPEAT, 1);
  assert.match(state.next.uri, /a2\.mp3$/);
  await manager.command(id, RENDERER_FEATURES.NEXT, 1);
  assert.equal(entry.queue.index, 1);
  assert.match(state.next.uri, /a1\.mp3$/, 'after the last one, the first one');
  await endTrack(setupResult);
  assert.equal(entry.queue.index, 0);
  // Next past the end wraps too while repeat is on, Previous before the start.
  await manager.command(id, RENDERER_FEATURES.PREVIOUS, 1);
  assert.equal(entry.queue.index, 1);

  await manager.command(id, RENDERER_FEATURES.REPEAT, 0);
  await endTrack(setupResult);
  assert.equal(entry.queue, null, 'the end of the queue');
});

// --- Catalog: browse and search -----------------------------------------------------

test('media ids: round trip, title kept, bounded at 512', () => {
  const id = mediaId(KIND.CONTAINER, 'abc', '1$3:7', 'Café: "Society"');
  assert.deepEqual(parseMediaId(id), {
    kind: 'c',
    platformId: 'abc',
    objectId: '1$3:7',
    title: 'Café: "Society"',
  });
  const long = mediaId(KIND.ITEM, 'abc', 'x', '🎵'.repeat(300));
  assert.ok(long.length <= MAX_ID);
  assert.equal(parseMediaId(long).objectId, 'x');
  assert.equal(mediaId(KIND.ITEM, 'abc', 'y'.repeat(600)), null);
  assert.equal(parseMediaId('spotify:track:1'), null);
  assert.equal(parseMediaId('dlna:c:abc:%E0%A4%A:x'), null);
});

test('browse: one server opens on its content, several on the list, none is an error', async () => {
  const { catalog, device, gladys, minidlna, platformId } = await setup();
  const root = await catalog.browse(device, { parentId: null, offset: 0, limit: 50 });
  assert.deepEqual(ids(root.items), ['Music', 'Video']);
  assert.equal(root.total, 2);
  assert.deepEqual(validateMediaItems(root.items), []);
  assert.equal(root.items[0].type, 'folder');
  assert.equal(root.items[0].playable, false);

  const albums = await catalog.browse(device, {
    parentId: mediaId(KIND.CONTAINER, platformId, '1$3', 'By album'),
    offset: 0,
    limit: 50,
  });
  assert.deepEqual(albums.items, [
    {
      id: mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road'),
      type: 'album',
      title: 'Abbey Road',
      subtitle: 'The Beatles',
      duration: null,
      artwork_key: gladys.artworkKey(ART('tn')),
      browsable: true,
      playable: true,
    },
  ]);
  const tracks = await catalog.browse(device, { parentId: albums.items[0].id, limit: 50 });
  assert.deepEqual(ids(tracks.items), ['Something', 'Come Together', 'cover']);
  assert.equal(tracks.items[0].duration, 210);
  assert.equal(tracks.items[2].playable, false, 'a picture is listed, never played');
  assert.deepEqual(validateMediaItems(tracks.items), []);

  // Two servers: the list of servers.
  const other = { ...minidlna, external_id: `${minidlna.external_id}2`, name: 'Another NAS' };
  gladys.devices.push(other);
  const list = await catalog.browse(device, { parentId: null, offset: 0, limit: 50 });
  assert.deepEqual(ids(list.items), ['Another NAS', minidlna.name]);
  assert.equal(list.items[1].id, mediaId(KIND.CONTAINER, platformId, '0', minidlna.name));

  gladys.devices.splice(0, gladys.devices.length);
  await assert.rejects(catalog.browse(device, { parentId: null }), /No DLNA media server/);
  await assert.rejects(
    catalog.browse(device, { parentId: 'spotify:album:1' }),
    /does not come from the DLNA integration/,
  );
});

test('browse pages: offset and limit reach the server, a too long id stays as a neutral row', async () => {
  const objects = [
    ...library(),
    ...Array.from({ length: 5 }, (_, n) => folder(`p${n}`, '2', `Folder ${n}`)),
    folder('z'.repeat(600), '2', 'Unreachable'),
  ];
  const { catalog, device, platformId } = await setup({ objects });
  const parentId = mediaId(KIND.CONTAINER, platformId, '2', 'Video');
  const first = await catalog.browse(device, { parentId, offset: 0, limit: 3 });
  assert.equal(first.total, 7);
  assert.deepEqual(ids(first.items), ['Holiday movie', 'Folder 0', 'Folder 1']);
  const last = await catalog.browse(device, { parentId, offset: 6, limit: 3 });
  assert.deepEqual(ids(last.items), ['Unreachable']);
  assert.equal(last.items[0].browsable, false);
  assert.match(last.items[0].id, /^dlna:x:[0-9a-f]{20}$/);
  assert.deepEqual(validateMediaItems(last.items), []);
});

test('search: by type with the server Search, deduplicated, and by crawl without it', async () => {
  const { catalog, device } = await setup();
  const albums = await catalog.search(device, { query: 'abbey', type: 'album', limit: 20 });
  assert.deepEqual(ids(albums.items), ['Abbey Road']);
  assert.equal(albums.items[0].type, 'album');

  const any = await catalog.search(device, { query: 'beatles', type: null, limit: 20 });
  // The album, then its tracks once each (the album view and the folder view
  // reference the same files in a real server: one row by resource).
  assert.equal(any.items[0].title, 'Abbey Road');
  assert.ok(any.items.some((item) => item.title === 'Come Together'));
  assert.deepEqual(validateMediaItems(any.items), []);

  const none = await catalog.search(device, { query: 'zzz', limit: 20 });
  assert.deepEqual(none.items, []);

  const crawled = await setup({ searchCaps: '' });
  const found = await crawled.catalog.search(crawled.device, { query: 'café', limit: 20 });
  assert.deepEqual(ids(found.items), ['Café Society']);
});

// --- Catalog: play, queue -----------------------------------------------------------

test('play an album: its tracks in track order, pictures left out', async () => {
  const { catalog, device, platformId, manager, id, state } = await setup();
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  const queue = manager.entries.get(id).queue;
  assert.deepEqual(
    queue.tracks.map((one) => one.title),
    ['Come Together', 'Something'],
  );
  assert.match(state.uri, /a1\.mp3$/);
  assert.equal(state.transport, 'PLAYING');
  assert.equal(queue.tracks[0].mediaId, mediaId(KIND.ITEM, platformId, 'a1', 'Come Together'));

  const page = await catalog.queueGet(device, { offset: 0, limit: 50 });
  assert.equal(page.currentIndex, 0);
  assert.equal(page.total, 2);
  assert.equal(page.items[0].id, queue.tracks[0].mediaId);
  assert.deepEqual(validateMediaItems(page.items), []);
});

test('next and append go into the queue; a jump plays the row', async () => {
  const { catalog, device, platformId, manager, id, state } = await setup();
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  const take5 = mediaId(KIND.ITEM, platformId, 'j1', 'Take Five');
  const cafe = mediaId(KIND.ITEM, platformId, 'j2', 'Café Society');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  await catalog.play(device, { id: cafe, type: 'track' }, 'append');
  await catalog.play(device, { id: take5, type: 'track' }, 'next');
  const titles = () => manager.entries.get(id).queue.tracks.map((one) => one.title);
  assert.deepEqual(titles(), ['Come Together', 'Take Five', 'Something', 'Café Society']);
  assert.match(state.next.uri, /j1\.mp3$/, 'the inserted track is the one preloaded');

  await catalog.queuePlay(device, 3);
  assert.match(state.uri, /j2\.mp3$/);
  const page = await catalog.queueGet(device, { offset: 2, limit: 1 });
  assert.deepEqual(ids(page.items), ['Something']);
  assert.equal(page.currentIndex, 3);
  assert.equal(page.total, 4);
  await assert.rejects(catalog.queuePlay(device, 9), /no longer in the play queue/);
});

test('enqueue: nothing playing plays now; another media becomes the first row', async () => {
  const { catalog, device, platformId, manager, id, state } = await setup();
  const take5 = mediaId(KIND.ITEM, platformId, 'j1', 'Take Five');
  await manager.refresh(id);
  await catalog.play(device, { id: take5, type: 'track' }, 'append');
  assert.match(state.uri, /j1\.mp3$/, 'nothing played: it plays');

  const entry = manager.entries.get(id);
  entry.queue = null;
  state.playForeign('Radio show');
  await manager.refresh(id);
  const single = await catalog.queueGet(device, { offset: 0, limit: 50 });
  assert.deepEqual(ids(single.items), ['Radio show']);
  assert.equal(single.currentIndex, 0);
  assert.equal(single.items[0].id, 'http://other/stream');

  await catalog.play(device, { id: take5, type: 'track' }, 'next');
  assert.equal(state.uri, 'http://other/stream', 'nothing replaced');
  assert.deepEqual(
    entry.queue.tracks.map((one) => one.title),
    ['Radio show', 'Take Five'],
  );
  // The URL of a queue row plays too.
  await catalog.play(device, { id: 'http://192.0.2.7/x.mp3', type: 'track' }, 'replace');
  assert.equal(state.uri, 'http://192.0.2.7/x.mp3');
});

test('the queue never passes its cap: played tracks make room first', async () => {
  const many = Array.from({ length: MAX_QUEUE }, (_, n) =>
    track(`m${n}`, '1$9', `Track ${n}`, 'X', 'Many', n + 1),
  );
  const objects = [...library(), folder('1$9', '1', 'Many'), ...many];
  const { catalog, device, platformId, manager, id } = await setup({ objects });
  await catalog.play(
    device,
    { id: mediaId(KIND.CONTAINER, platformId, '1$9', 'Many'), type: 'folder' },
    'replace',
  );
  const queue = manager.entries.get(id).queue;
  assert.equal(queue.tracks.length, MAX_QUEUE);
  await catalog.queuePlay(device, 5);
  const take5 = mediaId(KIND.ITEM, platformId, 'j1', 'Take Five');
  await catalog.play(device, { id: take5, type: 'track' }, 'append');
  assert.equal(queue.tracks.length, MAX_QUEUE);
  assert.equal(queue.index, 4, 'one played track dropped');
  assert.equal(queue.tracks.at(-1).title, 'Take Five');
  await catalog.queuePlay(device, 0);
  for (let n = 0; n < 2; n += 1) {
    await catalog.play(device, { id: take5, type: 'track' }, 'append').catch(() => {});
  }
  await assert.rejects(
    catalog.play(device, { id: take5, type: 'track' }, 'append'),
    /queue is full/,
  );
});

test('an id whose object moved is found again by its title; gone is an error', async () => {
  const { catalog, device, platformId, manager, id } = await setup();
  // minidlna numbered its objects again: the old id designates nothing, or
  // another object.
  const moved = mediaId(KIND.CONTAINER, platformId, '9$9', 'Abbey Road');
  await catalog.play(device, { id: moved, type: 'album' }, 'replace');
  assert.deepEqual(
    manager.entries.get(id).queue.tracks.map((one) => one.title),
    ['Come Together', 'Something'],
    'the album, not the folder of the same name',
  );
  const other = mediaId(KIND.ITEM, platformId, 'j1', 'Come Together');
  await catalog.play(device, { id: other, type: 'track' }, 'replace');
  assert.equal(manager.entries.get(id).queue.tracks[0].title, 'Come Together');

  // The follow-up of the starts runs on the test clock: let it end first.
  await manager.pending;
  await assert.rejects(
    catalog.play(device, { id: mediaId(KIND.ITEM, platformId, '9$9', 'Nowhere'), type: 'track' }),
    /no longer on the media server/,
  );
  await assert.rejects(
    catalog.play({ external_id: 'ext:dlna:server:x' }, { id: moved, type: 'album' }),
    /Pick a DLNA renderer/,
  );
  await assert.rejects(catalog.play(device, { id: 'spotify:x', type: 'track' }), /DLNA catalog/);
});

test('a scene id of a server deleted from Gladys says so', async () => {
  const { catalog, device, platformId, gladys } = await setup();
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  gladys.devices.splice(
    gladys.devices.findIndex(
      (one) => one.name.includes('minidlna') || one.external_id.includes(':server:'),
    ),
    1,
  );
  await assert.rejects(catalog.play(device, { id: album, type: 'album' }), /no longer in Gladys/);
});

// --- Artwork ------------------------------------------------------------------------

test('artwork: a large cover is made small enough, never fetched outside http(s)', async () => {
  const fixture = readFileSync(new URL('./fixtures/artwork/baseline-420.jpg', import.meta.url));
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.endsWith('missing.jpg')) return new Response('no', { status: 404 });
    return new Response(fixture, { headers: { 'content-type': 'image/jpeg' } });
  };
  const gladys = createSdkFakeGladys({ selector: 'dlna' });
  const catalog = createCatalog({ gladys, registry: { fetchImpl }, renderers: null });
  const key = gladys.artworkKey('http://192.0.2.50:8200/AlbumArt/1.jpg');
  const image = Buffer.from(await catalog.artwork(key), 'base64');
  assert.equal(image[0], 0xff);
  assert.ok(image.length <= 300 * 1024);
  await assert.rejects(catalog.artwork('art-000000000000'), /Unknown artwork/);
  await assert.rejects(
    catalog.artwork(gladys.artworkKey('http://192.0.2.50:8200/missing.jpg')),
    /HTTP 404/,
  );
  await assert.rejects(catalog.artwork(gladys.artworkKey('file:///etc/passwd')), /not an http/);
  assert.equal(fetched.length, 2);
  gladys.disconnect();
});

test('the music handlers answer through the SDK: acks of the fake Gladys', async (t) => {
  const { gladys, catalog, device } = await setup({ sdk: true, t });
  gladys.onMusicBrowse((one, options) => catalog.browse(one, options));
  gladys.onMusicQueueGet((one, options) => catalog.queueGet(one, options));
  const browse = await gladys.fake.musicBrowse(device);
  assert.equal(browse.success, true);
  assert.deepEqual(ids(browse.data.items), ['Music', 'Video']);
  const queue = await gladys.fake.musicQueueGet(device);
  assert.equal(queue.success, true);
  assert.equal(queue.data.total, 0);
  assert.equal(queue.data.current_index, null);
  assert.equal(POLL_INTERVALS_MS.IDLE, 15000);
});

test('a title cut to fit its id still designates its object', async () => {
  // Each CJK character takes 9 characters once encoded: the id keeps half
  // of the title, which is no longer the title of the object.
  const title =
    '交響曲第9番ニ短調作品125「合唱付き」第4楽章：プレスト〜アレグロ・アッサイ〜歓喜の歌（シラーの詩による）ベルリン・フィルハーモニー管弦楽団';
  const objects = [...library(), track('jp1', '1$2', title, 'ベートーヴェン', '交響曲', 1)];
  const { catalog, device, platformId, manager, id } = await setup({ objects });
  const media = mediaId(KIND.ITEM, platformId, 'jp1', title);
  assert.ok(Array.from(parseMediaId(media).title).length < 80, 'the title was cut');
  await catalog.play(device, { id: media, type: 'track' }, 'replace');
  assert.equal(manager.entries.get(id).queue.tracks[0].title, title);
});

test('after a pause, the first position read again is published', async () => {
  const { manager, id, tick } = await setup();
  const entry = manager.entries.get(id);
  const playing = {
    transportState: 'PLAYING',
    playback: PLAYBACK.PLAYING,
    uri: 'http://x/a.mp3',
    title: 'A',
    artist: '',
    album: '',
    albumArtUri: null,
    position: 31,
    duration: 200,
    volume: null,
    muted: null,
  };
  assert.equal(manager.nowPlayingOf(entry, playing).position, 31);
  const paused = { ...playing, transportState: 'PAUSED_PLAYBACK', playback: PLAYBACK.PAUSED };
  assert.equal(manager.nowPlayingOf(entry, paused).position, 31);
  tick(600_000);
  assert.equal(manager.nowPlayingOf(entry, paused).position, 31);
  // Resumed: the renderer still reads 31 s, which is not frozen.
  const resumed = manager.nowPlayingOf(entry, playing);
  assert.equal(resumed.playback_state, 1);
  assert.equal(resumed.position, 31);
});

test('an artist plays each track once, though its server lists it twice', async () => {
  const artist = {
    kind: 'container',
    id: '1$4',
    parentId: '1',
    title: 'Miles Davis',
    upnpClass: 'object.container.person.musicArtist',
  };
  const twice = (one, id, parentId) => ({ ...one, id, parentId });
  const so = track('m1', '1$4$1', 'So What', 'Miles Davis', 'Kind of Blue', 1);
  const fred = track('m2', '1$4$1', 'Freddie Freeloader', 'Miles Davis', 'Kind of Blue', 2);
  const objects = [
    ...library(),
    artist,
    folder('1$4$0', '1$4', '- All Albums -'),
    twice(so, 'm1-all', '1$4$0'),
    twice(fred, 'm2-all', '1$4$0'),
    { ...folder('1$4$1', '1$4', 'Kind of Blue'), upnpClass: 'object.container.album.musicAlbum' },
    so,
    fred,
  ];
  const { catalog, device, platformId, manager, id } = await setup({ objects });
  const media = mediaId(KIND.CONTAINER, platformId, '1$4', 'Miles Davis');
  await catalog.play(device, { id: media, type: 'artist' }, 'replace');
  assert.deepEqual(
    manager.entries.get(id).queue.tracks.map((one) => one.title),
    ['So What', 'Freddie Freeloader'],
  );
});

test('the current track queued next is not preloaded: the renderer could not tell them apart', async () => {
  const { catalog, device, platformId, manager, id, state } = await setup();
  const album = mediaId(KIND.CONTAINER, platformId, '1$3$1', 'Abbey Road');
  await catalog.play(device, { id: album, type: 'album' }, 'replace');
  assert.match(state.next.uri, /a2\.mp3$/);
  const current = mediaId(KIND.ITEM, platformId, 'a1', 'Come Together');
  await catalog.play(device, { id: current, type: 'track' }, 'next');
  assert.deepEqual(
    manager.entries.get(id).queue.tracks.map((one) => one.title),
    ['Come Together', 'Come Together', 'Something'],
  );
  assert.equal(state.next.uri, '', 'the next URI taken back');
});

test('nothing playable to enqueue leaves what plays untouched', async () => {
  const { manager, id, state } = await setup();
  state.playForeign('Radio show');
  await manager.refresh(id);
  await assert.rejects(manager.enqueue(id, [], 'next'), /nothing|playable/i);
  assert.equal(manager.entries.get(id).queue, null, 'no queue made of the radio');
});
