// -----------------------------------------------------------------------------
// UPnP control: one SOAP request per action (UPnP Device Architecture 1.0,
// section 3). A few lines of string building, no SOAP library needed.
// -----------------------------------------------------------------------------

import { child, childText, escapeXml, find, parseXml } from './xml.js';
import { fetchText } from './http.js';

export class UpnpError extends Error {
  constructor(action, { code, description, status } = {}) {
    const detail = [code, description].filter(Boolean).join(' ');
    super(`${action} failed${detail ? `: ${detail}` : status ? `: HTTP ${status}` : ''}`);
    this.name = 'UpnpError';
    this.action = action;
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

/** The SOAP envelope of an action. `args` keeps its insertion order: some
 * devices refuse arguments out of the SCPD order. */
export function buildEnvelope(serviceType, action, args = {}) {
  const argsXml = Object.entries(args)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${escapeXml(serviceType)}">${argsXml}</u:${action}></s:Body>` +
    '</s:Envelope>'
  );
}

/**
 * Read the out arguments of an action response: `{ name: text }`. Throws an
 * UpnpError on a SOAP fault.
 */
export function parseResponse(action, xml, status) {
  let envelope;
  try {
    envelope = parseXml(xml);
  } catch {
    throw new UpnpError(action, { status, description: 'invalid SOAP response' });
  }
  const body = child(envelope, 'Body') ?? find(envelope, 'Body');
  const fault = find(body, 'Fault');
  if (fault) {
    const upnpError = find(fault, 'UPnPError');
    throw new UpnpError(action, {
      status,
      code: childText(upnpError, 'errorCode') || undefined,
      description: childText(upnpError, 'errorDescription') || childText(fault, 'faultstring'),
    });
  }
  const response = body?.children.find((node) => node.name === `${action}Response`);
  if (!response) {
    if (status && status >= 400) {
      throw new UpnpError(action, { status });
    }
    throw new UpnpError(action, { status, description: 'no response element' });
  }
  return Object.fromEntries(response.children.map((node) => [node.name, node.text.trim()]));
}

/**
 * Call an action on a service control URL and resolve its out arguments.
 */
export async function soapCall({ controlUrl, serviceType, action, args, timeoutMs, fetchImpl }) {
  const { status, text } = await fetchText(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType}#${action}"`,
    },
    body: buildEnvelope(serviceType, action, args),
    timeoutMs,
    fetchImpl,
  });
  try {
    return parseResponse(action, text, status);
  } catch (err) {
    // The same code means different things in two services (701 is
    // "Transition not available" in AVTransport, "Invalid Name" in
    // RenderingControl): the error says which service answered.
    err.serviceType = serviceType;
    throw err;
  }
}
