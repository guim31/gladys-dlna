// -----------------------------------------------------------------------------
// The UPnP building blocks: XML reader, SSDP answers, descriptions, SCPDs,
// SOAP envelopes and faults, DIDL-Lite. Real device documents where we have
// them (Denon AVR-S650H, async-upnp-client fixtures).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childText, decodeEntities, escapeXml, find, parseXml } from '../src/upnp/xml.js';
import {
  locationsFromSsdp,
  mediaDevicesOf,
  parseDescription,
  parseScpd,
  parseSsdpHeaders,
  platformIdOf,
} from '../src/upnp/description.js';
import { UpnpError, buildEnvelope, parseResponse } from '../src/upnp/soap.js';
import {
  buildMetadata,
  formatDuration,
  guessMime,
  parseDidl,
  parseDuration,
  pickResource,
  sinkAccepts,
} from '../src/upnp/didl.js';
import { normalizeText, searchLiteral } from '../src/upnp/server.js';
import { fetchText, isHttpUrl } from '../src/upnp/http.js';
import { readFixture, soapFault, ssdpAnswer } from './helpers/fakeNetwork.js';

const DENON = 'http://192.0.2.10:60006/upnp/desc/aios_device/aios_device.xml';

test('the XML reader drops prefixes, decodes entities and CDATA, skips comments and DTDs', () => {
  const root = parseXml(
    '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "boom">]><!-- c --><a:r xmlns:a="u">' +
      '<a:t k="1 &amp; 2">x &lt; y &#233;&#x41;&x;</a:t><c><![CDATA[<raw>]]></c><e/></a:r>',
  );
  assert.equal(root.name, 'r');
  assert.equal(childText(root, 't'), 'x < y éA&x;'); // no DTD entity expansion
  assert.equal(find(root, 't').attributes.k, '1 & 2');
  assert.equal(childText(root, 'c'), '<raw>');
  assert.equal(childText(root, 'e'), '');
  assert.throws(() => parseXml('no xml at all'), /Not an XML document/);
});

test('escapeXml and decodeEntities are inverse', () => {
  const text = `Tom & "Jerry" <it's>`;
  assert.equal(decodeEntities(escapeXml(text)), text);
});

test('SSDP answers give their LOCATION, http(s) only and deduplicated', () => {
  const answers = [
    ssdpAnswer(DENON),
    ssdpAnswer(DENON),
    { headers: 'HTTP/1.1 200 OK\r\nLOCATION: file:///etc/passwd\r\n\r\n' },
    { headers: 'garbage' },
    {},
  ];
  assert.deepEqual(locationsFromSsdp(answers), [DENON]);
  assert.equal(parseSsdpHeaders(ssdpAnswer(DENON).headers).st, 'upnp:rootdevice');
});

test('the Denon description: the renderer and the server are embedded devices', () => {
  const description = parseDescription(readFixture('denon-avr-s650h', 'device.xml'), DENON);
  assert.equal(description.root.deviceType, 'urn:schemas-denon-com:device:AiosDevice:1');
  const { renderers, servers } = mediaDevicesOf(description);
  assert.equal(renderers.length, 1);
  assert.equal(servers.length, 1);
  const [renderer] = renderers;
  assert.equal(renderer.friendlyName, 'Denon AVR-S650H');
  assert.equal(platformIdOf(renderer), '00000000-0000-4000-8000-000000000002');
  const av = renderer.services.find((service) => service.serviceType.includes('AVTransport'));
  // Relative URLs resolved against the description, on its port (60006).
  assert.equal(av.controlUrl, 'http://192.0.2.10:60006/upnp/control/renderer_dvc/AVTransport');
  assert.equal(av.scpdUrl, 'http://192.0.2.10:60006/upnp/scpd/renderer_dvc/AVTransport.xml');
});

test('URLBase wins over the description location for relative URLs', () => {
  const location = 'http://192.0.2.41:49152/uuid-x/description.xml';
  const description = parseDescription(
    readFixture('volumio-upmpdcli', 'description.xml'),
    location,
  );
  const av = description.root.services.find((service) =>
    service.serviceType.includes('AVTransport'),
  );
  assert.equal(av.controlUrl, 'http://192.0.2.41:49152/ctl/AVTransport');
});

test('a description without a media device, or not a description, gives nothing', () => {
  const igd =
    '<root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><UDN>uuid:1</UDN></device></root>';
  assert.deepEqual(mediaDevicesOf(parseDescription(igd, 'http://192.0.2.1/')), {
    renderers: [],
    servers: [],
  });
  assert.throws(() => parseDescription('<html></html>', 'http://192.0.2.1/'), /Not a UPnP/);
});

test('a UDN that is not a UUID still gives a valid external id segment', () => {
  assert.equal(platformIdOf({ udn: 'uuid:RINCON_ABC:01400' }), 'rincon_abc_01400');
});

test('the Denon SCPDs: actions and the 0-100 volume range', () => {
  const av = parseScpd(readFixture('denon-avr-s650h', 'scpd-AVTransport.xml'));
  assert.ok(av.actions.has('SetNextAVTransportURI'));
  assert.ok(av.actions.has('Pause'));
  const rc = parseScpd(readFixture('denon-avr-s650h', 'scpd-RenderingControl.xml'));
  assert.ok(rc.actions.has('SetMute'));
  assert.deepEqual(rc.ranges.Volume, { minimum: 0, maximum: 100 });
});

test('SOAP: the envelope keeps the argument order and escapes values', () => {
  const envelope = buildEnvelope(
    'urn:schemas-upnp-org:service:AVTransport:1',
    'SetAVTransportURI',
    {
      InstanceID: '0',
      CurrentURI: 'http://x/?a=1&b=2',
      CurrentURIMetaData: '<DIDL-Lite/>',
    },
  );
  assert.match(
    envelope,
    /<InstanceID>0<\/InstanceID><CurrentURI>http:\/\/x\/\?a=1&amp;b=2<\/CurrentURI>/,
  );
  assert.match(envelope, /<CurrentURIMetaData>&lt;DIDL-Lite\/&gt;<\/CurrentURIMetaData>/);
  assert.match(
    envelope,
    /<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">/,
  );
});

test('SOAP: the real Denon answers are read', () => {
  assert.deepEqual(
    parseResponse('GetVolume', readFixture('denon-avr-s650h', 'soap-GetVolume.xml')),
    {
      CurrentVolume: '11',
    },
  );
  const transport = parseResponse(
    'GetTransportInfo',
    readFixture('denon-avr-s650h', 'soap-GetTransportInfo.xml'),
  );
  assert.equal(transport.CurrentTransportState, 'STOPPED');
});

test('SOAP: a fault becomes an UpnpError with its code', () => {
  assert.throws(
    () => parseResponse('Play', soapFault(701, 'Transition not available'), 500),
    (err) =>
      err instanceof UpnpError &&
      err.code === '701' &&
      /Transition not available/.test(err.message),
  );
  assert.throws(() => parseResponse('Play', '<html>500</html>', 500), UpnpError);
  assert.throws(() => parseResponse('Play', 'not xml', 200), UpnpError);
});

test('DIDL: the escaped track metadata of a renderer is read, entities included', () => {
  const position = parseResponse(
    'GetPositionInfo',
    readFixture('aup-dmr', 'action_GetPositionInfo.xml'),
  );
  const { items } = parseDidl(position.TrackMetaData);
  assert.equal(items[0].title, 'Test track');
  assert.equal(items[0].artist, 'A & B > C');
  assert.equal(parseDuration(position.TrackDuration), 194);
});

test('DIDL: empty or unimplemented metadata is no metadata', () => {
  assert.deepEqual(parseDidl(''), { items: [], containers: [], objects: [] });
  assert.deepEqual(parseDidl('NOT_IMPLEMENTED'), { items: [], containers: [], objects: [] });
  const position = parseResponse(
    'GetPositionInfo',
    readFixture('denon-avr-s650h', 'soap-GetPositionInfo.xml'),
  );
  assert.deepEqual(parseDidl(position.TrackMetaData).items, []);
});

test('DIDL: a Browse answer of a server, items with their resources', () => {
  const answer = parseResponse('Browse', readFixture('aup-dms', 'action_Browse_metadata_item.xml'));
  const [item] = parseDidl(answer.Result).items;
  assert.equal(item.title, 'Test song');
  assert.equal(item.artist, 'Test artist');
  assert.equal(item.album, 'Test album');
  assert.equal(item.trackNumber, 2);
  assert.equal(item.resources[0].uri, 'http://dlna_dms:1234/media/2483.mp3');
  assert.equal(item.resources[0].duration, 120);
  const containers = parseDidl(
    parseResponse('Browse', readFixture('aup-dms', 'action_Browse_children_0.xml')).Result,
  ).containers;
  assert.deepEqual(
    containers.map((container) => container.title),
    ['Browse Folders', 'Music', 'Pictures', 'Video'],
  );
});

test('durations: parse and format', () => {
  assert.equal(parseDuration('0:02:00.938'), 120);
  assert.equal(parseDuration('01:00:01'), 3601);
  assert.equal(parseDuration('NOT_IMPLEMENTED'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(formatDuration(3601), '1:00:01');
});

test('the real Denon sink picks the resource it can play', () => {
  const { Sink } = parseResponse(
    'GetProtocolInfo',
    readFixture('denon-avr-s650h', 'soap-GetProtocolInfo.xml'),
  );
  const sink = Sink.split(',');
  const item = {
    resources: [
      { uri: 'http://s/v.mkv', protocolInfo: 'http-get:*:video/x-matroska:*' },
      { uri: 'http://s/a.flac', protocolInfo: 'http-get:*:audio/flac:*' },
    ],
  };
  assert.equal(pickResource(item, sink).uri, 'http://s/a.flac');
  assert.equal(pickResource(item, []).uri, 'http://s/v.mkv');
  assert.ok(
    sinkAccepts(['http-get:*:audio/L16;rate=44100;channels=2:*'], 'http-get:*:audio/L16:*'),
  );
});

test('SetAVTransportURI metadata: title, class from the MIME type, escaped URL', () => {
  const metadata = buildMetadata({ url: 'http://r/live?x=1&y=2', title: 'FIP' });
  const [item] = parseDidl(metadata).items;
  assert.equal(item.title, 'FIP');
  assert.equal(item.upnpClass, 'object.item.audioItem.musicTrack');
  assert.equal(item.resources[0].uri, 'http://r/live?x=1&y=2');
  assert.equal(item.resources[0].protocolInfo, 'http-get:*:audio/mpeg:*');
  assert.equal(guessMime('http://s/movie.mp4'), 'video/mp4');
  assert.equal(guessMime('http://s/stream'), 'audio/mpeg');
});

test('search literals and text normalization', () => {
  assert.equal(searchLiteral('a "b" \\c'), '"a \\"b\\" \\\\c"');
  assert.equal(normalizeText('  Café   Del  MAR '), 'cafe del mar');
});

test('http: only http(s) URLs, bounded bodies', async () => {
  assert.ok(isHttpUrl('http://192.0.2.1:8200/rootDesc.xml'));
  assert.ok(!isHttpUrl('ftp://x'));
  assert.ok(!isHttpUrl('not a url'));
  const big = async () => new Response('x'.repeat(2000), { status: 200 });
  await assert.rejects(fetchText('http://x/', { fetchImpl: big, maxBytes: 1000 }), /too large/);
  const declared = async () =>
    new Response('x', { status: 200, headers: { 'content-length': '99999999' } });
  await assert.rejects(fetchText('http://x/', { fetchImpl: declared }), /too large/);
});
