// -----------------------------------------------------------------------------
// UPnP refusals, as the user reads them: real SOAP faults through the fake
// network, a clear text in English and French instead of "701 Transition not
// available", the raw code kept for the logs, and no misleading success.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptedDenon, AV, RC } from './helpers/scriptedRenderer.js';
import { soapFault } from './helpers/fakeNetwork.js';
import { UpnpError, parseResponse } from '../src/upnp/soap.js';
import { RENDERER_FEATURES } from '../src/devices/renderer.js';
import { PLAYER_WIDGET, createWidgets, TEXTS } from '../src/widgets.js';
import {
  COMMANDS,
  NO_DLNA_MEDIA,
  NoDlnaMediaError,
  STOP_WITHOUT_DLNA_MEDIA,
  UserError,
  explainUpnpError,
} from '../src/errors.js';

const FAULT_701 = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'soap-faults',
    'fault-701-transition-not-available.xml',
  ),
  'utf8',
);
const AV_TYPE = 'urn:schemas-upnp-org:service:AVTransport:1';
const RC_TYPE = 'urn:schemas-upnp-org:service:RenderingControl:1';

function upnpError(action, code, description, serviceType = AV_TYPE) {
  try {
    parseResponse(action, soapFault(code, description), 500);
  } catch (err) {
    err.serviceType = serviceType;
    return err;
  }
  throw new Error('no fault');
}

/** The Denon with the forum report's soundbar behaviour: nothing loaded over
 * DLNA (it plays Spotify), every transport command refused by a 701. */
async function soundbarOnSpotify() {
  const denon = await scriptedDenon();
  const widgets = createWidgets({ gladys: denon.gladys, renderers: denon.manager });
  const act = (actionKey) =>
    widgets[PLAYER_WIDGET].action({ actionKey, params: {}, settings: { device: denon.id } });
  for (const action of ['Play', 'Pause', 'Stop', 'Next', 'Previous']) {
    denon.network.onAction(AV, action, () => FAULT_701);
  }
  await denon.manager.refresh(denon.id);
  return { ...denon, act };
}

const shown = (text) => [text.en, text.fr];

test('the 701 fixture is a UPnPError fault: code and label read, service known', async () => {
  assert.throws(
    () => parseResponse('Play', FAULT_701, 500),
    (err) =>
      err instanceof UpnpError &&
      err.code === '701' &&
      err.message === 'Play failed: 701 Transition not available',
  );
  const { manager, id, network } = await soundbarOnSpotify();
  const renderer = await manager.rendererOf(manager.entryOf(id));
  await assert.rejects(renderer.play(), (err) => err.serviceType === AV_TYPE);
  assert.equal(network.actions('Play').length, 1);
});

test('every user text is short, bilingual, and never shows the raw code', () => {
  const errors = [
    ...Object.values(COMMANDS).flatMap((command) => [
      [upnpError('Play', 701, 'Transition not available'), { command }],
      [upnpError('Play', 701, 'Transition not available'), { command, mediaLoaded: true }],
    ]),
    [upnpError('SetAVTransportURI', 701, 'Transition not available'), {}],
    ...[402, 501, 702, 703, 704, 705, 714, 715, 716, 717, 718, 999].map((code) => [
      upnpError('Play', code, 'x'),
      {},
    ]),
    ...[401, 402, 501, 600, 601, 602, 701, 702].map((code) => [
      upnpError('SetVolume', code, 'x', RC_TYPE),
      {},
    ]),
  ];
  for (const [err, context] of errors) {
    const { text } = explainUpnpError(err, context);
    for (const message of shown(text)) {
      assert.ok(message.length <= 200, `${message.length}: ${message}`);
      assert.doesNotMatch(message, /\b\d{3}\b/, message);
    }
    assert.notEqual(text.en, text.fr);
  }
  assert.equal(STOP_WITHOUT_DLNA_MEDIA.en.length <= 200, true);
  assert.equal(STOP_WITHOUT_DLNA_MEDIA.fr.length <= 200, true);
});

test('the codes of the specification read as their meaning', () => {
  const en = (code, action = 'Play', serviceType = AV_TYPE, context = {}) =>
    explainUpnpError(upnpError(action, code, 'x', serviceType), context).text.en;
  assert.match(en(701), /^Nothing to play over DLNA/);
  assert.match(en(702), /^Nothing to play over DLNA/, '702 No contents');
  assert.match(en(701, 'Play', AV_TYPE, { mediaLoaded: true }), /cannot start playing right now/);
  assert.match(en(701, 'Next', AV_TYPE, { mediaLoaded: true }), /single media/);
  assert.match(en(714), /illegal MIME type/);
  assert.match(en(716), /resource not found/);
  assert.match(en(718), /invalid InstanceID/);
  assert.match(en(402), /invalid args/);
  assert.match(en(501), /action failed/);
  assert.match(en(702, 'SetVolume', RC_TYPE), /invalid InstanceID/, 'RenderingControl 702');
  assert.match(en(701, 'SetVolume', RC_TYPE), /^The renderer refused the command/, 'not a 701 AV');
  assert.match(en(999), /^The renderer refused the command/);
  // Pause sent as Stop (no Pause in the SCPD): the text follows the request.
  assert.match(
    explainUpnpError(upnpError('Stop', 701, 'x'), { command: COMMANDS.PAUSE }).text.en,
    /^Nothing to pause/,
  );
});

test('the forum report: Play, Pause, Stop, Next on a soundbar playing Spotify', async () => {
  const { act, manager, id, network } = await soundbarOnSpotify();
  // The widget: a message in the user's language, not "The action failed."
  assert.deepEqual(await act('toggle'), NO_DLNA_MEDIA[COMMANDS.PLAY]);
  assert.deepEqual(await act('stop'), NO_DLNA_MEDIA[COMMANDS.STOP]);
  // The device commands: an error in the configured language.
  const refused = (command, language) => (err) =>
    err instanceof NoDlnaMediaError &&
    err.message === NO_DLNA_MEDIA[command][language] &&
    err.cause.message.includes('701 Transition not available');
  await assert.rejects(manager.command(id, RENDERER_FEATURES.PAUSE, 1), refused('pause', 'en'));
  manager.language = () => 'fr';
  await assert.rejects(manager.command(id, RENDERER_FEATURES.NEXT, 1), refused('next', 'fr'));
  await assert.rejects(manager.command(id, RENDERER_FEATURES.PLAY, 1), refused('play', 'fr'));
  // A refused Play is not followed: one Play per press, no 75 s of retries.
  assert.equal(network.actions('Play').length, 2);
  assert.equal(manager.pending, undefined);
});

test('a Stop accepted with no DLNA media loaded is not reported as "Stopped"', async () => {
  const denon = await scriptedDenon();
  const { manager, id, network, state } = denon;
  const widget = createWidgets({ gladys: denon.gladys, renderers: manager })[PLAYER_WIDGET];
  const stop = () => widget.action({ actionKey: 'stop', params: {}, settings: { device: id } });
  await manager.refresh(id);
  assert.deepEqual(await stop(), STOP_WITHOUT_DLNA_MEDIA);
  assert.equal(network.actions('Stop').length, 1, 'sent anyway: it may stop the other source');
  network.onAction(AV, 'GetTransportInfo', () => ({ CurrentTransportState: 'NO_MEDIA_PRESENT' }));
  assert.deepEqual(await stop(), STOP_WITHOUT_DLNA_MEDIA);
  network.onAction(AV, 'GetTransportInfo', () => ({ CurrentTransportState: state.transport }));
  state.uri = 'http://192.0.2.50:8200/MediaItems/1.flac';
  assert.deepEqual(await stop(), TEXTS.STOPPED);
});

test('a 701 on the media Gladys loaded is not "another source"', async () => {
  const { manager, id, network } = await scriptedDenon();
  await manager.playUrl(id, 'http://radio.example/live.mp3');
  await manager.pending;
  network.onAction(AV, 'Pause', () => FAULT_701);
  await assert.rejects(
    manager.command(id, RENDERER_FEATURES.PAUSE, 1),
    (err) =>
      err instanceof UserError &&
      !(err instanceof NoDlnaMediaError) &&
      /cannot pause this media/.test(err.message),
  );
});

test('a scene URL refused by the renderer fails with a clear text', async () => {
  const { manager, id, network } = await scriptedDenon();
  manager.language = () => 'fr';
  network.onAction(AV, 'SetAVTransportURI', () => soapFault(716, 'Resource not found'));
  await assert.rejects(
    manager.playUrl(id, 'http://nas.example/missing.mp3'),
    (err) => err instanceof UserError && /^Le lecteur n'atteint pas le média/.test(err.message),
  );
  network.onAction(RC, 'SetVolume', () => soapFault(501, 'Action Failed'));
  await assert.rejects(manager.setVolume(id, 30), /échec de l'action/);
});

test('the start follow-up gives up at once when the media is lost and Play is refused', async () => {
  const { manager, id, network, state } = await scriptedDenon();
  let presses = 0;
  network.onAction(AV, 'Play', () => {
    presses += 1;
    if (presses === 1) {
      state.uri = ''; // the renderer dropped the media
      return {};
    }
    return FAULT_701;
  });
  const url = 'https://radio.example/live.mp3';
  await manager.playUrl(id, url);
  network.onAction(AV, 'SetAVTransportURI', () => soapFault(501, 'Action Failed'));
  const started = Date.now();
  await manager.pending;
  assert.equal(presses, 2, 'one Play refused by 701, then no retry');
  assert.ok(Date.now() - started < 1000);
});

test('a Play refused by 701 on our loaded media keeps being followed (a wake-up)', async () => {
  const { manager, id, network, state } = await scriptedDenon();
  let presses = 0;
  network.onAction(AV, 'Play', () => {
    presses += 1;
    if (presses === 1) return {};
    if (presses < 4) return FAULT_701;
    state.transport = 'PLAYING';
    return {};
  });
  await manager.playUrl(id, 'https://radio.example/live.mp3');
  await manager.pending;
  assert.equal(state.transport, 'PLAYING');
  assert.equal(presses, 4);
});
