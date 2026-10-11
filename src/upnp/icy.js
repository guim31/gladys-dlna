// -----------------------------------------------------------------------------
// The name of a web radio, from its ICY (Shoutcast / Icecast) headers.
//
// A renderer shows the title of the DIDL metadata it was given; for a URL
// played without a title, that would be the raw URL. Asking the stream with
// `Icy-MetaData: 1` makes the server answer its name in `icy-name`, and
// interleave a metadata block (`StreamTitle='…';`) every `icy-metaint` bytes
// of audio. One short request, bounded in time and size: the headers, and
// at most the first block, never the stream itself.
// -----------------------------------------------------------------------------

export const ICY_TIMEOUT_MS = 2500;
// The first metadata block comes after `icy-metaint` bytes of audio (16000
// on most servers): beyond this, the stream title is not worth the wait.
export const MAX_ICY_METAINT = 65536;
const MAX_TEXT = 200;

/** A header value: the bytes of a ByteString, read as UTF-8 when they are. */
function decodeHeader(value) {
  if (!value) return '';
  const bytes = Buffer.from(value, 'latin1');
  const utf8 = bytes.toString('utf8');
  return (utf8.includes('\uFFFD') ? value : utf8).trim();
}

function clean(text) {
  const trimmed = String(text ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.length > MAX_TEXT ? trimmed.slice(0, MAX_TEXT) : trimmed;
}

/** The StreamTitle of an ICY metadata block (`StreamTitle='…';StreamUrl='…';`). */
export function parseStreamTitle(block) {
  const text = Buffer.isBuffer(block) ? decodeBlock(block) : String(block ?? '');
  const match = text.match(/StreamTitle='(.*?)';/s);
  return clean(match?.[1]);
}

function decodeBlock(bytes) {
  const text = bytes.toString('utf8').replace(/\0+$/, '');
  return text.includes('\uFFFD') ? bytes.toString('latin1').replace(/\0+$/, '') : text;
}

/**
 * Reads exact byte counts from a body, keeping what a chunk brought beyond.
 * Every read gives up when `signal` aborts, whatever the body does with it.
 */
function byteReader(reader, signal) {
  let buffered = Buffer.alloc(0);
  const aborted = new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('ICY read timed out')), {
      once: true,
    });
  });
  aborted.catch(() => {});
  return async (count) => {
    while (buffered.length < count) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      buffered = Buffer.concat([buffered, Buffer.from(value)]);
    }
    const bytes = buffered.subarray(0, count);
    buffered = buffered.subarray(count);
    return bytes;
  };
}

/**
 * `{ name, streamTitle }` of an http(s) stream ('' when it does not tell),
 * or null when it cannot be asked (not reachable, not a stream, too slow).
 * Never throws.
 */
export async function readStreamInfo(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = ICY_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'Icy-MetaData': '1' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const header = (name) => decodeHeader(response.headers?.get?.(name));
    const name = clean(header('icy-name'));
    const metaint = Number(header('icy-metaint'));
    let streamTitle = '';
    reader = response.body?.getReader?.();
    if (reader && Number.isInteger(metaint) && metaint > 0 && metaint <= MAX_ICY_METAINT) {
      try {
        const read = byteReader(reader, controller.signal);
        const head = await read(metaint + 1);
        if (head.length === metaint + 1) {
          const length = head[metaint] * 16;
          if (length > 0) streamTitle = parseStreamTitle(await read(length));
        }
      } catch {
        // Too slow or cut: the name alone will do.
      }
    }
    return { name, streamTitle };
  } finally {
    clearTimeout(timer);
    // Never download the stream: drop the connection.
    controller.abort();
    reader?.cancel?.().catch(() => {});
  }
}

/** The title to show for a stream: its name, its current title, or null. */
export async function streamTitleOf(url, options) {
  const info = await readStreamInfo(url, options);
  return info?.name || info?.streamTitle || null;
}
