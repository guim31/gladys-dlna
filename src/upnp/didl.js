// -----------------------------------------------------------------------------
// DIDL-Lite: the metadata format of ContentDirectory answers and of the
// renderer's current track (UPnP AV ContentDirectory:1, appendix B).
// -----------------------------------------------------------------------------

import { childText, children, escapeXml, parseXml } from './xml.js';

/** "H+:MM:SS[.F+]" (UPnP AV duration) → seconds, or null when unknown. */
export function parseDuration(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^\+?(\d+):(\d{1,2}):(\d{1,2})(\.\d+)?/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Seconds → "H:MM:SS", the format SetAVTransportURI metadata expects. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * A metadata text, or '' when it holds nothing but quotes and spaces: the
 * Denon AVR-S650H describes an unknown artist or album as `""`.
 */
export function cleanText(value) {
  const text = String(value ?? '').trim();
  return /^["'\s]*$/.test(text) ? '' : text;
}

function parseObject(node) {
  const artists = children(node, 'artist')
    .map((artist) => ({ role: artist.attributes.role, name: cleanText(artist.text) }))
    .filter((artist) => artist.name);
  return {
    kind: node.name, // 'item' | 'container'
    id: node.attributes.id ?? '',
    parentId: node.attributes.parentID ?? '',
    title: cleanText(childText(node, 'title')),
    upnpClass: childText(node, 'class'),
    // The performer first: some servers list the composer or the album
    // artist with a role, the performer without one.
    artist:
      artists.find((artist) => !artist.role)?.name ||
      artists[0]?.name ||
      cleanText(childText(node, 'creator')),
    album: cleanText(childText(node, 'album')),
    trackNumber: Number(childText(node, 'originalTrackNumber')) || null,
    albumArtUri: childText(node, 'albumArtURI'),
    // Every albumArtURI, with its DLNA profile (JPEG_TN: 160 px at most,
    // JPEG_SM: 640 px at most; none: the image as the server has it).
    albumArts: children(node, 'albumArtURI')
      .map((art) => ({ uri: art.text.trim(), profile: art.attributes.profileID ?? '' }))
      .filter((art) => art.uri),
    resources: children(node, 'res')
      .map((res) => ({
        uri: res.text.trim(),
        protocolInfo: res.attributes.protocolInfo ?? '',
        duration: parseDuration(res.attributes.duration),
      }))
      .filter((res) => res.uri),
  };
}

// Preference of the DLNA image profiles, by use: the now-playing frame
// renders under 400 px wide (the small 640 px variant first, then the
// server's own image, resized by the integration when too heavy, the
// thumbnail last), a list row under 64 px (the thumbnail first).
const ARTWORK_PROFILES = {
  player: [
    'JPEG_SM',
    'PNG_SM',
    '',
    'JPEG_MED',
    'PNG_MED',
    'JPEG_LRG',
    'PNG_LRG',
    'JPEG_TN',
    'PNG_TN',
  ],
  list: [
    'JPEG_TN',
    'PNG_TN',
    'JPEG_SM',
    'PNG_SM',
    '',
    'JPEG_MED',
    'PNG_MED',
    'JPEG_LRG',
    'PNG_LRG',
  ],
};

/**
 * The albumArtURI of an object to show `for` the player or a list row: an
 * absolute http(s) URL, or null. An unknown profile comes after the known
 * ones.
 */
export function pickArtwork(object, use = 'player') {
  const order = ARTWORK_PROFILES[use] ?? ARTWORK_PROFILES.player;
  const rank = (art) => {
    const index = order.indexOf(art.profile.toUpperCase());
    return index === -1 ? order.length : index;
  };
  const arts = (object?.albumArts ?? []).filter((art) => /^https?:\/\//i.test(art.uri));
  if (arts.length === 0) return null;
  return [...arts].sort((a, b) => rank(a) - rank(b))[0].uri;
}

/**
 * Parse a DIDL-Lite document into `{ items, containers, objects }`, `objects`
 * holding both in the order of the document. An empty or unparsable document
 * (renderers answer "NOT_IMPLEMENTED" or nothing) gives empty lists, never an
 * error: metadata is a nicety.
 */
export function parseDidl(xml) {
  const empty = { items: [], containers: [], objects: [] };
  const text = String(xml ?? '').trim();
  if (!text.startsWith('<')) {
    return empty;
  }
  let root;
  try {
    root = parseXml(text);
  } catch {
    return empty;
  }
  const objects = root.children
    .filter((node) => node.name === 'item' || node.name === 'container')
    .map(parseObject);
  return {
    items: objects.filter((object) => object.kind === 'item'),
    containers: objects.filter((object) => object.kind === 'container'),
    objects,
  };
}

/** The MIME type of a `protocolInfo` ("http-get:*:audio/mpeg:*" → "audio/mpeg"). */
export function mimeOf(protocolInfo) {
  return (
    String(protocolInfo ?? '')
      .split(':')[2]
      ?.toLowerCase() ?? ''
  );
}

/**
 * Whether a renderer sink accepts a resource. `sink` is the list of
 * protocolInfo of ConnectionManager.GetProtocolInfo; an unknown sink accepts
 * everything (the renderer will say no by itself).
 */
export function sinkAccepts(sink, protocolInfo) {
  if (!sink || sink.length === 0) return true;
  const mime = mimeOf(protocolInfo);
  return sink.some((entry) => {
    const accepted = mimeOf(entry);
    return accepted === '*' || accepted === mime || accepted.split(';')[0] === mime;
  });
}

/** The first resource of an item the renderer can play, or the first one. */
export function pickResource(item, sink) {
  return item.resources.find((res) => sinkAccepts(sink, res.protocolInfo)) ?? item.resources[0];
}

const MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m3u8: 'application/vnd.apple.mpegurl',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Best guess of the MIME type of a URL, from its extension. Web radios
 * rarely have one: they default to MP3, by far the most common stream. */
export function guessMime(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = String(url ?? '');
  }
  const extension = pathname.split('.').pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'audio/mpeg';
}

function upnpClassOf(mime) {
  if (mime.startsWith('video/')) return 'object.item.videoItem';
  if (mime.startsWith('image/')) return 'object.item.imageItem';
  return 'object.item.audioItem.musicTrack';
}

/**
 * The DIDL-Lite metadata sent with SetAVTransportURI. Several renderers refuse
 * a URI without metadata, or play it without a title.
 */
export function buildMetadata({
  url,
  title,
  mime,
  protocolInfo,
  artist,
  album,
  albumArtUri,
  duration,
  upnpClass,
}) {
  const type = mime || guessMime(url);
  // The server's own protocolInfo keeps its DLNA flags (seek, transcoding).
  const resAttributes = [`protocolInfo="${escapeXml(protocolInfo || `http-get:*:${type}:*`)}"`];
  if (duration) {
    resAttributes.push(`duration="${formatDuration(duration)}"`);
  }
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="0" parentID="-1" restricted="1">' +
    `<dc:title>${escapeXml(title || url)}</dc:title>` +
    (artist ? `<upnp:artist>${escapeXml(artist)}</upnp:artist>` : '') +
    (album ? `<upnp:album>${escapeXml(album)}</upnp:album>` : '') +
    (albumArtUri ? `<upnp:albumArtURI>${escapeXml(albumArtUri)}</upnp:albumArtURI>` : '') +
    `<upnp:class>${escapeXml(upnpClass || upnpClassOf(type))}</upnp:class>` +
    `<res ${resAttributes.join(' ')}>${escapeXml(url)}</res>` +
    '</item></DIDL-Lite>'
  );
}
