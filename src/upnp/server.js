// -----------------------------------------------------------------------------
// MediaServer client: ContentDirectory Browse and Search (UPnP AV
// ContentDirectory:1), and the media lookup the scene actions rely on.
// -----------------------------------------------------------------------------

import { soapCall } from './soap.js';
import { SERVICE_TYPES, findService } from './description.js';
import { parseDidl } from './didl.js';

export const SEARCH_BY = ['any', 'title', 'artist', 'album', 'folder'];

const PAGE_SIZE = 200;
// Bounds of the crawl used when a server cannot search: enough for a family
// library, and a scene action never browses a huge one for minutes.
const MAX_BROWSE_CALLS = 300;
const MAX_DEPTH = 8;

/** Lowercase, accents removed, spaces collapsed: "Café  Del Mar" → "cafe del mar". */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** A string literal of the SearchCriteria grammar: `"` and `\` escaped. */
export function searchLiteral(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function fieldsFor(by) {
  switch (by) {
    case 'title':
      return ['title'];
    case 'artist':
      return ['artist'];
    case 'album':
      return ['album'];
    default:
      return ['title', 'artist', 'album'];
  }
}

function matches(item, by, query) {
  const needle = normalizeText(query);
  return fieldsFor(by).some((field) => normalizeText(item[field]).includes(needle));
}

/** Album order: by album, then track number, then title. */
function albumOrder(a, b) {
  return (
    normalizeText(a.album).localeCompare(normalizeText(b.album)) ||
    (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) ||
    normalizeText(a.title).localeCompare(normalizeText(b.title))
  );
}

// A picture of a folder (cover.jpg) is an item with a resource too: never
// handed to a renderer as a track.
const playable = (item) =>
  item.resources.length > 0 && !/^object\.item\.imageitem/i.test(item.upnpClass ?? '');

/** A lookup that ran out of its time budget (see MediaServer.withDeadline). */
export class SearchTimeoutError extends Error {
  constructor(seconds) {
    super(
      `The media server did not answer the search within ${seconds} s: ` +
        'search something narrower (an album, a folder path)',
    );
    this.name = 'SearchTimeoutError';
  }
}

export class MediaServer {
  constructor(device, { fetchImpl, timeoutMs = 10000, now = () => Date.now() } = {}) {
    this.device = device;
    this.contentDirectory = findService(device, SERVICE_TYPES.CONTENT_DIRECTORY);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.shared = this; // what the scoped copies write back (capabilities cache)
    this.searchCapabilities = undefined;
  }

  /**
   * A view of this server whose requests all share one deadline: a crawl of a
   * big library stops cleanly before the scene action it serves times out,
   * instead of browsing on after the core gave up.
   */
  withDeadline(budgetMs) {
    const scoped = Object.create(this);
    scoped.deadline = this.now() + budgetMs;
    scoped.budgetSeconds = Math.round(budgetMs / 1000);
    return scoped;
  }

  async call(action, args) {
    let timeoutMs = this.timeoutMs;
    if (this.deadline !== undefined) {
      const remaining = this.deadline - this.now();
      if (remaining <= 0) throw new SearchTimeoutError(this.budgetSeconds);
      timeoutMs = Math.min(timeoutMs, remaining);
    }
    try {
      return await soapCall({
        controlUrl: this.contentDirectory.controlUrl,
        serviceType: this.contentDirectory.serviceType,
        action,
        args,
        timeoutMs,
        fetchImpl: this.fetchImpl,
      });
    } catch (err) {
      // A request cut by the deadline says so, not "operation aborted".
      if (this.deadline !== undefined && this.now() >= this.deadline) {
        throw new SearchTimeoutError(this.budgetSeconds);
      }
      throw err;
    }
  }

  /** One page of Browse: `{ items, containers, total, returned }`. */
  async browse(objectId, { metadata = false, start = 0, count = PAGE_SIZE } = {}) {
    const answer = await this.call('Browse', {
      ObjectID: objectId,
      BrowseFlag: metadata ? 'BrowseMetadata' : 'BrowseDirectChildren',
      Filter: '*',
      StartingIndex: String(start),
      RequestedCount: String(count),
      SortCriteria: '',
    });
    return {
      ...parseDidl(answer.Result),
      total: Number(answer.TotalMatches) || 0,
      returned: Number(answer.NumberReturned) || 0,
    };
  }

  /** Every child of a container, page after page, up to `max` objects. */
  async browseChildren(objectId, { max = 1000 } = {}) {
    const items = [];
    const containers = [];
    let start = 0;
    for (;;) {
      const page = await this.browse(objectId, { start, count: PAGE_SIZE });
      items.push(...page.items);
      containers.push(...page.containers);
      const received = page.items.length + page.containers.length;
      start += page.returned || received;
      // TotalMatches may be 0 when the server does not know it.
      const done = received === 0 || (page.total > 0 ? start >= page.total : received < PAGE_SIZE);
      if (done || items.length + containers.length >= max) break;
    }
    return { items, containers };
  }

  /** The properties the server can search on (a Set, '*' meaning all), cached. */
  async getSearchCapabilities() {
    if (this.searchCapabilities === undefined) {
      try {
        const { SearchCaps } = await this.call('GetSearchCapabilities', {});
        const caps = (SearchCaps ?? '').trim();
        this.searchCapabilities =
          caps === '*'
            ? '*'
            : new Set(
                caps
                  .split(',')
                  .map((cap) => cap.trim())
                  .filter(Boolean),
              );
      } catch {
        this.searchCapabilities = new Set();
      }
    }
    return this.searchCapabilities;
  }

  async canSearch(property) {
    const caps = await this.getSearchCapabilities();
    return caps === '*' || caps.has(property);
  }

  /** Every result of a Search, page after page, up to `max` objects. */
  async search(containerId, criteria, { max = PAGE_SIZE, pageSize = PAGE_SIZE } = {}) {
    const items = [];
    const containers = [];
    let start = 0;
    for (;;) {
      const answer = await this.call('Search', {
        ContainerID: containerId,
        SearchCriteria: criteria,
        Filter: '*',
        StartingIndex: String(start),
        RequestedCount: String(pageSize),
        SortCriteria: '',
      });
      const page = parseDidl(answer.Result);
      items.push(...page.items);
      containers.push(...page.containers);
      const received = page.items.length + page.containers.length;
      const total = Number(answer.TotalMatches) || 0;
      start += Number(answer.NumberReturned) || received;
      const done = received === 0 || (total > 0 ? start >= total : received < pageSize);
      if (done || items.length + containers.length >= max) break;
    }
    return { items, containers };
  }

  /**
   * The SearchCriteria of an item search, built from what the server says it
   * can search on. Returns null when it cannot search on any useful property.
   */
  async itemCriteria(by, query) {
    const literal = searchLiteral(query);
    const properties = {
      title: ['dc:title'],
      artist: ['upnp:artist', 'dc:creator'],
      album: ['upnp:album'],
    };
    const wanted = fieldsFor(by).flatMap((field) => properties[field]);
    const searchable = [];
    for (const property of wanted) {
      if (await this.canSearch(property)) searchable.push(property);
    }
    // An artist search tries upnp:artist first, dc:creator only as a fallback.
    const usable =
      by === 'artist' && searchable.includes('upnp:artist') ? ['upnp:artist'] : searchable;
    if (usable.length === 0) return null;
    const clause = usable.map((property) => `${property} contains ${literal}`).join(' or ');
    const itemClass = (await this.canSearch('upnp:class'))
      ? 'upnp:class derivedfrom "object.item" and '
      : '';
    return usable.length > 1 && itemClass ? `${itemClass}(${clause})` : `${itemClass}${clause}`;
  }

  /**
   * Breadth-first crawl from the root, bounded in calls and depth, handing
   * every container and item to `visit`. `visit` returns true to stop.
   */
  async crawl(visit, { from = '0' } = {}) {
    const queue = [{ id: from, depth: 0 }];
    let calls = 0;
    while (queue.length > 0 && calls < MAX_BROWSE_CALLS) {
      const { id, depth } = queue.shift();
      calls += 1;
      const { items, containers } = await this.browseChildren(id);
      for (const object of [...containers, ...items]) {
        if (visit(object)) return;
      }
      if (depth + 1 < MAX_DEPTH) {
        queue.push(...containers.map((container) => ({ id: container.id, depth: depth + 1 })));
      }
    }
  }

  /** Items of a container and of its sub-containers (depth first), up to `limit`. */
  async collectItems(containerId, { limit, depth = 0 } = {}) {
    const { items, containers } = await this.browseChildren(containerId);
    const collected = items.filter(playable);
    if (depth < 3) {
      for (const container of containers) {
        if (collected.length >= limit) break;
        collected.push(
          ...(await this.collectItems(container.id, {
            limit: limit - collected.length,
            depth: depth + 1,
          })),
        );
      }
    }
    return collected.slice(0, limit);
  }

  /**
   * Find a container: by path ("Music/Albums/Abbey Road", from the root,
   * each segment matched on its title) or by title anywhere.
   */
  async findContainer(query) {
    const segments = query
      .split('/')
      .map((segment) => normalizeText(segment))
      .filter(Boolean);
    if (segments.length === 0) return null;

    if (query.includes('/')) {
      let current = { id: '0', title: '' };
      for (const segment of segments) {
        const { containers } = await this.browseChildren(current.id);
        const next =
          containers.find((container) => normalizeText(container.title) === segment) ??
          containers.find((container) => normalizeText(container.title).includes(segment));
        if (!next) return null;
        current = next;
      }
      return current;
    }

    const [needle] = segments;
    const pick = (containers) =>
      containers.find((container) => normalizeText(container.title) === needle) ??
      containers.find((container) => normalizeText(container.title).includes(needle));

    if ((await this.canSearch('dc:title')) && (await this.canSearch('upnp:class'))) {
      try {
        const { containers } = await this.search(
          '0',
          `upnp:class derivedfrom "object.container" and dc:title contains ${searchLiteral(query.trim())}`,
        );
        const found = pick(containers);
        if (found) return found;
      } catch (err) {
        // A server may declare Search and still fail on a criteria: crawl.
        if (err instanceof SearchTimeoutError) throw err;
      }
    }

    let exact = null;
    let partial = null;
    await this.crawl((object) => {
      if (object.kind !== 'container') return false;
      const title = normalizeText(object.title);
      if (title === needle) {
        exact = object;
        return true;
      }
      if (!partial && title.includes(needle)) partial = object;
      return false;
    });
    return exact ?? partial;
  }

  /**
   * The playable items a scene asks for: `by` is one of SEARCH_BY. Album and
   * folder results keep the album order; the others keep the server order.
   */
  async findMedia({ by = 'any', query, limit = 200 }) {
    const text = String(query ?? '').trim();
    if (!text) return [];

    if (by === 'folder') {
      const container = await this.findContainer(text);
      return container ? this.collectItems(container.id, { limit }) : [];
    }

    let items = null;
    const criteria = await this.itemCriteria(by, text);
    if (criteria) {
      try {
        const result = await this.search('0', criteria, { max: limit * 2 });
        items = result.items;
      } catch (err) {
        if (err instanceof SearchTimeoutError) throw err;
        items = null; // declared but broken Search: crawl below
      }
    }
    if (items === null) {
      items = [];
      await this.crawl((object) => {
        if (object.kind === 'item' && playable(object) && matches(object, by, text)) {
          items.push(object);
        }
        return items.length >= limit;
      });
    }
    // Servers match "contains" loosely (or not on the asked field): check.
    let found = items.filter((item) => playable(item) && matches(item, by, text));
    if (by === 'album') found = found.sort(albumOrder);
    if (found.length === 0 && by === 'any') {
      // Nothing by title, artist or album: maybe the name of a folder.
      const container = await this.findContainer(text);
      if (container) return this.collectItems(container.id, { limit });
    }
    return found.slice(0, limit);
  }
}
