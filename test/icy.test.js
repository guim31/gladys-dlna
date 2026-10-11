// -----------------------------------------------------------------------------
// The name of a web radio played without a title: read from its ICY headers
// (simulated streams, no network), shown instead of the bare URL.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStreamTitle, readStreamInfo, streamTitleOf } from '../src/upnp/icy.js';
import { scriptedDenon } from './helpers/scriptedRenderer.js';
import { createSceneActions } from '../src/scenes.js';
import { parseDidl } from '../src/upnp/didl.js';
import { RENDERER_FEATURES } from '../src/devices/renderer.js';

const URL_FIP = 'http://icecast.example/fip-midfi.mp3';

/** A header value as it travels: UTF-8 bytes read as a ByteString. */
const wire = (text) => Buffer.from(text, 'utf8').toString('latin1');

/** One ICY metadata block: its length byte (×16) then the padded text. */
function metadataBlock(text) {
  const bytes = Buffer.from(text, 'utf8');
  const length = Math.ceil(bytes.length / 16);
  return Buffer.concat([Buffer.from([length]), bytes, Buffer.alloc(length * 16 - bytes.length)]);
}

/**
 * A fake stream server: answers headers, then `audio` bytes and the
 * metadata block, then endless audio. Records the requests and how many
 * chunks were pulled.
 */
function icyServer({ headers = {}, metaint, title, status = 200, stall = false } = {}) {
  const requests = [];
  let pulled = 0;
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const chunks = [];
    if (metaint) chunks.push(Buffer.alloc(metaint, 0x55));
    if (title !== undefined) chunks.push(metadataBlock(`StreamTitle='${title}';StreamUrl='';`));
    const body = new ReadableStream({
      async pull(controller) {
        pulled += 1;
        if (stall) return new Promise(() => {});
        // Split the first chunk to exercise the reassembly.
        const next = chunks.shift() ?? Buffer.alloc(1024, 0x55);
        if (next.length > 100) {
          controller.enqueue(new Uint8Array(next.subarray(0, 100)));
          chunks.unshift(next.subarray(100));
        } else {
          controller.enqueue(new Uint8Array(next));
        }
        return undefined;
      },
    });
    return new Response(body, {
      status,
      headers: {
        'content-type': 'audio/mpeg',
        ...headers,
        ...(metaint ? { 'icy-metaint': String(metaint) } : {}),
      },
    });
  };
  return { fetchImpl, requests, pulled: () => pulled };
}

test('the station name is read from icy-name, asking the ICY metadata', async () => {
  const server = icyServer({ headers: { 'icy-name': 'FIP' } });
  assert.deepEqual(await readStreamInfo(URL_FIP, server), { name: 'FIP', streamTitle: '' });
  assert.equal(server.requests[0].init.headers['Icy-MetaData'], '1');
  assert.equal(server.requests[0].init.method, 'GET');
});

test('a UTF-8 station name survives the header encoding', async () => {
  const server = icyServer({ headers: { 'icy-name': wire('Radio Nova – Fréquence') } });
  assert.equal(await streamTitleOf(URL_FIP, server), 'Radio Nova – Fréquence');
  const latin1 = icyServer({ headers: { 'icy-name': 'Fréquence Jazz' } });
  assert.equal(await streamTitleOf(URL_FIP, latin1), 'Fréquence Jazz');
});

test('without icy-name, the title on air (StreamTitle) is used', async () => {
  const server = icyServer({ metaint: 300, title: 'Miles Davis - So What' });
  assert.deepEqual(await readStreamInfo(URL_FIP, server), {
    name: '',
    streamTitle: 'Miles Davis - So What',
  });
  assert.equal(await streamTitleOf(URL_FIP, server), 'Miles Davis - So What');
  const both = icyServer({ headers: { 'icy-name': 'FIP' }, metaint: 300, title: 'A - B' });
  assert.equal(await streamTitleOf(URL_FIP, both), 'FIP');
});

test('the stream is never downloaded: the read stops after the first block', async () => {
  const server = icyServer({ headers: { 'icy-name': 'FIP' }, metaint: 300, title: 'A - B' });
  await readStreamInfo(URL_FIP, server);
  assert.ok(server.pulled() <= 6, `${server.pulled()} chunks pulled`);
  // A huge metadata interval is not waited for.
  const far = icyServer({ headers: { 'icy-name': 'FIP' }, metaint: 1_000_000, title: 'A' });
  assert.deepEqual(await readStreamInfo(URL_FIP, far), { name: 'FIP', streamTitle: '' });
  assert.ok(far.pulled() <= 1);
});

test('a stalled stream keeps its name and ends within the time bound', async () => {
  const server = icyServer({ headers: { 'icy-name': 'FIP' }, metaint: 300, stall: true });
  const started = Date.now();
  assert.deepEqual(await readStreamInfo(URL_FIP, { ...server, timeoutMs: 50 }), {
    name: 'FIP',
    streamTitle: '',
  });
  assert.ok(Date.now() - started < 2000);
});

test('no name to read: null, never an exception', async () => {
  assert.equal(await streamTitleOf(URL_FIP, icyServer()), null, 'not an ICY server');
  assert.equal(await readStreamInfo(URL_FIP, icyServer({ status: 404 })), null);
  const down = {
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  };
  assert.equal(await readStreamInfo(URL_FIP, down), null);
});

test('StreamTitle parsing keeps quotes and drops padding', () => {
  assert.equal(
    parseStreamTitle("StreamTitle='Guns N' Roses - Don't Cry';"),
    "Guns N' Roses - Don't Cry",
  );
  assert.equal(parseStreamTitle(Buffer.from("StreamTitle='Été';\0\0\0")), 'Été');
  assert.equal(parseStreamTitle('nothing'), '');
});

test('play_url without a title shows the station name, not the URL', async () => {
  const denon = await scriptedDenon();
  const { manager, id, state, gladys, registry, feature } = denon;
  const asked = [];
  manager.streamTitle = async (url) => {
    asked.push(url);
    return 'FIP';
  };
  const actions = createSceneActions({ gladys, registry, renderers: manager });
  await actions.play_url({ renderer: id, url: URL_FIP, title: '' });
  assert.deepEqual(asked, [URL_FIP]);
  assert.equal(parseDidl(state.metadata).items[0].title, 'FIP');
  await manager.pending;

  // A renderer that drops the metadata (or reports the bare URL) still
  // shows the name.
  state.metadata = '';
  await manager.refresh(id);
  assert.equal(manager.viewOf(id).status.title, 'FIP');
  const nowPlaying = gladys.published
    .filter((entry) => entry.featureExternalId === feature(RENDERER_FEATURES.NOW_PLAYING))
    .at(-1);
  assert.deepEqual(nowPlaying.state, { text: 'FIP' });

  // A title given wins, and no request is made.
  await actions.play_url({ renderer: id, url: URL_FIP, title: 'My radio' });
  assert.equal(asked.length, 1);
  assert.equal(parseDidl(state.metadata).items[0].title, 'My radio');
});

test('the URL stays the last resort when the stream tells nothing', async () => {
  const { manager, id, state } = await scriptedDenon();
  // The fake LAN answers 404 to the stream: no ICY name.
  await manager.playUrl(id, URL_FIP);
  assert.equal(parseDidl(state.metadata).items[0].title, URL_FIP);
});
