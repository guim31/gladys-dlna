// -----------------------------------------------------------------------------
// HTTP helper shared by the UPnP clients.
//
// Every request is bounded twice: in time (a device that went to sleep must not
// hold a Gladys command past its 5 s acknowledgement) and in size (a
// description or a Browse answer is a few kilobytes; the sandbox has 256 MB).
// The `fetch` implementation is injectable so that the tests never touch the
// network.
// -----------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 4000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(`Response too large (${declared} bytes)`, { status: response.status });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new HttpError('Response too large', { status: response.status });
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError('Response too large', { status: response.status });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a URL and resolve its body as text. Resolves `{ status, ok, text }`;
 * only network failures, timeouts and oversized bodies throw, so that a caller
 * can read a SOAP fault out of a 500 answer.
 */
export async function fetchText(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const response = await fetchImpl(url, {
    method,
    headers,
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await readBounded(response, maxBytes);
  return { status: response.status, ok: response.ok, text };
}

/** Only plain http(s) URLs are ever fetched (SSDP answers are untrusted). */
export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
