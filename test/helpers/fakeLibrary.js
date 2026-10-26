// -----------------------------------------------------------------------------
// An in-memory ContentDirectory for the tests: Browse with paging, Search on
// the criteria shape the integration writes ("class derivedfrom … and (prop
// contains … or …)"), and the search capabilities the test chooses.
// -----------------------------------------------------------------------------

import { escapeXml } from '../../src/upnp/xml.js';

export const track = (id, parentId, title, artist, album, trackNumber, ext = 'mp3') => ({
  kind: 'item',
  id,
  parentId,
  title,
  artist,
  album,
  trackNumber,
  upnpClass: 'object.item.audioItem.musicTrack',
  res: {
    uri: `http://192.0.2.50:8200/MediaItems/${id}.${ext}`,
    mime: `audio/${ext === 'mp3' ? 'mpeg' : ext}`,
    duration: '0:03:30',
  },
});

export const folder = (id, parentId, title) => ({
  kind: 'container',
  id,
  parentId,
  title,
  upnpClass: 'object.container.storageFolder',
});

export function defaultLibrary() {
  return [
    folder('1', '0', 'Music'),
    folder('2', '0', 'Video'),
    folder('1$1', '1', 'Albums'),
    folder('1$2', '1', 'Jazz'),
    folder('1$1$1', '1$1', 'Abbey Road'),
    folder('1$1$2', '1$1', 'Kind of Blue'),
    // Server order is not album order: the integration sorts albums.
    track('t3', '1$1$1', 'Something', 'The Beatles', 'Abbey Road', 2),
    track('t1', '1$1$1', 'Come Together', 'The Beatles', 'Abbey Road', 1),
    track('t4', '1$1$1', "Octopus's Garden", 'The Beatles', 'Abbey Road', 5),
    track('k1', '1$1$2', 'So What', 'Miles Davis', 'Kind of Blue', 1, 'flac'),
    track('k2', '1$1$2', 'Freddie Freeloader', 'Miles Davis', 'Kind of Blue', 2, 'flac'),
    track('j1', '1$2', 'Take Five', 'Dave Brubeck', 'Time Out', 3),
    track('j2', '1$2', 'Café Society', 'Brubeck Quartet', 'Live', 1),
    {
      kind: 'item',
      id: 'v1',
      parentId: '2',
      title: 'Holiday movie',
      artist: '',
      album: '',
      upnpClass: 'object.item.videoItem',
      res: {
        uri: 'http://192.0.2.50:8200/MediaItems/v1.mkv',
        mime: 'video/x-matroska',
        duration: '1:30:00',
      },
    },
  ];
}

function didl(objects) {
  const body = objects
    .map((object) => {
      // Album art, with its DLNA profile like minidlna writes it.
      const arts = (object.albumArts ?? [])
        .map(
          ({ uri, profile }) =>
            `<upnp:albumArtURI${profile ? ` dlna:profileID="${profile}"` : ''}>${escapeXml(uri)}</upnp:albumArtURI>`,
        )
        .join('');
      if (object.kind === 'container') {
        return (
          `<container id="${escapeXml(object.id)}" parentID="${escapeXml(object.parentId)}" restricted="1">` +
          `<dc:title>${escapeXml(object.title)}</dc:title><upnp:class>${object.upnpClass}</upnp:class>` +
          (object.artist ? `<upnp:artist>${escapeXml(object.artist)}</upnp:artist>` : '') +
          `${arts}</container>`
        );
      }
      return (
        `<item id="${escapeXml(object.id)}" parentID="${escapeXml(object.parentId)}" restricted="1">` +
        `<dc:title>${escapeXml(object.title)}</dc:title>` +
        (object.artist ? `<upnp:artist>${escapeXml(object.artist)}</upnp:artist>` : '') +
        (object.album ? `<upnp:album>${escapeXml(object.album)}</upnp:album>` : '') +
        (object.trackNumber
          ? `<upnp:originalTrackNumber>${object.trackNumber}</upnp:originalTrackNumber>`
          : '') +
        `<upnp:class>${object.upnpClass}</upnp:class>${arts}` +
        `<res protocolInfo="http-get:*:${object.res.mime}:DLNA.ORG_OP=01" duration="${object.res.duration}">` +
        `${escapeXml(object.res.uri)}</res></item>`
      );
    })
    .join('');
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"' +
    ' xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">' +
    `${body}</DIDL-Lite>`
  );
}

const PROPERTY = {
  'dc:title': 'title',
  'upnp:artist': 'artist',
  'dc:creator': 'artist',
  'upnp:album': 'album',
};

function evaluate(criteria, object) {
  const unescape = (text) => text.replace(/\\(.)/g, '$1');
  const derived = criteria.match(/upnp:class derivedfrom "([^"]+)"/);
  if (derived && !object.upnpClass.startsWith(derived[1])) return false;
  const clauses = [
    ...criteria.matchAll(
      /(dc:title|upnp:artist|dc:creator|upnp:album) contains "((?:[^"\\]|\\.)*)"/g,
    ),
  ];
  if (clauses.length === 0) return true;
  return clauses.some(([, property, value]) =>
    String(object[PROPERTY[property]] ?? '')
      .toLowerCase()
      .includes(unescape(value).toLowerCase()),
  );
}

/**
 * Serve the library on a server control URL of the fake network.
 * @param {object} options `{ searchCaps, objects, pageSize }`
 */
export function serveLibrary(
  network,
  controlUrl,
  { searchCaps = '*', objects = defaultLibrary(), pageSize = 2 } = {},
) {
  const stats = { browse: 0, search: 0 };
  const page = (matches, args) => {
    const start = Number(args.StartingIndex) || 0;
    // Servers may return fewer objects than asked: page small, like some do.
    const count = Math.min(Number(args.RequestedCount) || matches.length, pageSize);
    const slice = matches.slice(start, start + count);
    return {
      Result: didl(slice),
      NumberReturned: String(slice.length),
      TotalMatches: String(matches.length),
      UpdateID: '1',
    };
  };
  network.onAction(controlUrl, 'GetSearchCapabilities', () => ({ SearchCaps: searchCaps }));
  network.onAction(controlUrl, 'Browse', (args) => {
    stats.browse += 1;
    if (args.BrowseFlag === 'BrowseMetadata') {
      return page(
        objects.filter((object) => object.id === args.ObjectID),
        { StartingIndex: 0 },
      );
    }
    return page(
      objects.filter((object) => object.parentId === args.ObjectID),
      args,
    );
  });
  network.onAction(controlUrl, 'Search', (args) => {
    stats.search += 1;
    if (!searchCaps) {
      return '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><detail><UPnPError><errorCode>708</errorCode><errorDescription>Unsupported or invalid search criteria</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>';
    }
    return page(
      objects.filter((object) => evaluate(args.SearchCriteria, object)),
      args,
    );
  });
  return stats;
}
