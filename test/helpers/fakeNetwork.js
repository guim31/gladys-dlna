// -----------------------------------------------------------------------------
// A fake LAN for the tests: an injectable `fetch` that serves the fixture
// devices (descriptions, SCPDs, recorded SOAP answers) and lets a test answer
// or fail any SOAP action. Nothing ever leaves the process.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml, escapeXml } from '../../src/upnp/xml.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'devices');

export const FIXTURE_NAMES = [
  'denon-avr-s650h',
  'aup-dmr',
  'aup-dmr-embedded',
  'aup-dms',
  'samsung-tv',
  'volumio-upmpdcli',
  'synthetic-renderer',
  'minidlna',
  'plex',
];

export function readFixture(name, file) {
  return readFileSync(join(FIXTURES, name, file), 'utf8');
}

export function fixtureOf(name) {
  return JSON.parse(readFixture(name, 'fixture.json'));
}

/** A SOAP answer carrying `outArgs`, the way a device writes it. */
export function soapResponse(serviceType, action, outArgs = {}) {
  const args = Object.entries(outArgs)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join('');
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action}Response xmlns:u="${serviceType}">${args}</u:${action}Response>` +
    '</s:Body></s:Envelope>'
  );
}

export function soapFault(code, description) {
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    '<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>' +
    `<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode>` +
    `<errorDescription>${description}</errorDescription></UPnPError></detail></s:Fault>` +
    '</s:Body></s:Envelope>'
  );
}

function response(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/xml' } });
}

export function createFakeNetwork() {
  const files = new Map(); // url → text
  const soap = new Map(); // `${controlUrl}#${action}` → text | (args) => outArgs | text
  const down = new Set(); // origins that do not answer
  const calls = []; // { url, action, args }

  const network = {
    calls,

    /** Serve a fixture device; resolves its description location. */
    serve(name) {
      const fixture = fixtureOf(name);
      const origin = new URL(fixture.location).origin;
      for (const [path, file] of Object.entries(fixture.files)) {
        files.set(`${origin}${path}`, readFixture(name, file));
      }
      for (const [key, file] of Object.entries(fixture.soap ?? {})) {
        const [path, action] = key.split('#');
        soap.set(`${origin}${path}#${action}`, readFixture(name, file));
      }
      return fixture.location;
    },

    file(url, text) {
      files.set(url, text);
    },

    /** Answer an action: a raw XML text, or a function of the in args. */
    onAction(controlUrl, action, answer) {
      soap.set(`${controlUrl}#${action}`, answer);
    },

    setDown(origin, isDown = true) {
      if (isDown) down.add(origin);
      else down.delete(origin);
    },

    actions(name) {
      return calls.filter((call) => call.action === name);
    },

    async fetch(url, init = {}) {
      const target = new URL(url);
      if (down.has(target.origin)) {
        throw new TypeError('fetch failed');
      }
      if ((init.method ?? 'GET') === 'GET') {
        return files.has(url) ? response(200, files.get(url)) : response(404, 'Not Found');
      }
      const soapAction = String(init.headers?.SOAPACTION ?? '').replace(/"/g, '');
      const [serviceType, action] = soapAction.split('#');
      const envelope = parseXml(init.body);
      const request = envelope.children[0]?.children[0];
      const args = Object.fromEntries(
        (request?.children ?? []).map((node) => [node.name, node.text]),
      );
      calls.push({ url, action, args });
      const answer = soap.get(`${url}#${action}`);
      if (answer === undefined) {
        // An action nobody scripted succeeds with no out argument.
        return response(200, soapResponse(serviceType, action));
      }
      if (typeof answer === 'function') {
        const result = await answer(args);
        if (typeof result === 'string') {
          return response(result.includes('Fault') ? 500 : 200, result);
        }
        return response(200, soapResponse(serviceType, action, result));
      }
      return response(200, answer);
    },
  };
  network.fetch = network.fetch.bind(network);
  return network;
}

/** The raw SSDP answer a device sends to an M-SEARCH upnp:rootdevice. */
export function ssdpAnswer(location, udn = 'uuid:00000000-0000-0000-0000-000000000000') {
  const { hostname } = new URL(location);
  return {
    source_ip: hostname,
    source_port: 1900,
    headers: [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      `LOCATION: ${location}`,
      'SERVER: Linux/4.9 UPnP/1.0 Test/1.0',
      'ST: upnp:rootdevice',
      `USN: ${udn}::upnp:rootdevice`,
      '',
      '',
    ].join('\r\n'),
  };
}
