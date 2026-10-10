// -----------------------------------------------------------------------------
// MediaRenderer client: AVTransport (play, pause, stop, next, previous, the
// media to play) and RenderingControl (volume, mute) of instance 0.
// -----------------------------------------------------------------------------

import { soapCall } from './soap.js';
import { SERVICE_TYPES, findService } from './description.js';
import { buildMetadata, parseDidl, parseDuration } from './didl.js';
import { escapeXml } from './xml.js';

const INSTANCE = { InstanceID: '0' };
const MASTER = { InstanceID: '0', Channel: 'Master' };

/** The logical playback state Gladys cares about, from CurrentTransportState. */
export const PLAYBACK = { PLAYING: 'playing', PAUSED: 'paused', STOPPED: 'stopped' };

export function playbackOf(transportState) {
  switch (transportState) {
    case 'PLAYING':
      return PLAYBACK.PLAYING;
    case 'PAUSED_PLAYBACK':
    case 'PAUSED_RECORDING':
      return PLAYBACK.PAUSED;
    case 'STOPPED':
    case 'NO_MEDIA_PRESENT':
      return PLAYBACK.STOPPED;
    default:
      // TRANSITIONING, RECORDING, vendor values: not a state of its own.
      return null;
  }
}

/**
 * What the renderer is playing, from the metadata of GetPositionInfo (the
 * current track) and GetMediaInfo (the current URI: a web radio often only
 * describes itself there).
 */
export function describeMedia(positionInfo = {}, mediaInfo = {}) {
  const [track] = parseDidl(positionInfo.TrackMetaData).items;
  const [media] = parseDidl(mediaInfo.CurrentURIMetaData).items;
  return {
    title: track?.title || media?.title || '',
    artist: track?.artist || media?.artist || '',
    album: track?.album || media?.album || '',
    uri: positionInfo.TrackURI || mediaInfo.CurrentURI || '',
  };
}

/** The http form of an https URL, or null. */
export function httpVariant(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    parsed.protocol = 'http:';
    if (parsed.port === '443') parsed.port = '';
    return parsed.href;
  } catch {
    return null;
  }
}

export class PlaybackNotStartedError extends Error {
  constructor(url) {
    super(
      String(url).startsWith('https:')
        ? 'The renderer did not start playing: it may not accept https URLs ' +
            '(nor the http address of this stream)'
        : 'The renderer did not start playing this URL: format not supported, ' +
            'or URL not reachable from the renderer',
    );
    this.name = 'PlaybackNotStartedError';
  }
}

export class Renderer {
  /**
   * @param {object} device parsed device of the description (see description.js)
   * @param {object} capabilities `{ avActions, rcActions, volumeRange }` read
   *   from the SCPDs; unknown capabilities are assumed present
   */
  constructor(device, { capabilities = {}, fetchImpl, timeoutMs } = {}) {
    this.device = device;
    this.avTransport = findService(device, SERVICE_TYPES.AV_TRANSPORT);
    this.renderingControl = findService(device, SERVICE_TYPES.RENDERING_CONTROL);
    this.connectionManager = findService(device, SERVICE_TYPES.CONNECTION_MANAGER);
    this.capabilities = capabilities;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.sink = null;
    // How long a renderer is given to reach PLAYING after Play.
    this.playWait = { timeoutMs: 6000, intervalMs: 500 };
    this.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }

  supports(service, action) {
    const actions = service === 'rc' ? this.capabilities.rcActions : this.capabilities.avActions;
    if (service === 'rc' && !this.renderingControl) return false;
    return !actions || actions.has(action);
  }

  get hasVolume() {
    return this.supports('rc', 'GetVolume') && this.supports('rc', 'SetVolume');
  }

  get hasMute() {
    return this.supports('rc', 'GetMute') && this.supports('rc', 'SetMute');
  }

  get volumeRange() {
    return this.capabilities.volumeRange ?? { minimum: 0, maximum: 100 };
  }

  call(service, action, args) {
    return soapCall({
      controlUrl: service.controlUrl,
      serviceType: service.serviceType,
      action,
      args,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  av(action, args = INSTANCE) {
    return this.call(this.avTransport, action, args);
  }

  rc(action, args = MASTER) {
    return this.call(this.renderingControl, action, args);
  }

  play() {
    return this.av('Play', { ...INSTANCE, Speed: '1' });
  }

  /** Pause is optional in AVTransport:1: without it, stop. */
  pause() {
    return this.supports('av', 'Pause') ? this.av('Pause') : this.stop();
  }

  stop() {
    return this.av('Stop');
  }

  next() {
    return this.av('Next');
  }

  previous() {
    return this.av('Previous');
  }

  get canPreload() {
    return this.supports('av', 'SetNextAVTransportURI') && !!this.capabilities.avActions;
  }

  setUri(uri, metadata = '') {
    return this.av('SetAVTransportURI', {
      ...INSTANCE,
      CurrentURI: uri,
      CurrentURIMetaData: metadata,
    });
  }

  setNextUri(uri, metadata = '') {
    return this.av('SetNextAVTransportURI', {
      ...INSTANCE,
      NextURI: uri,
      NextURIMetaData: metadata,
    });
  }

  /** Load a URL and press Play. Many renderers refuse SetAVTransportURI
   * while they play, so the current media is stopped first (a refused Stop
   * is not an error). */
  async startUrl(url, metadata) {
    try {
      const { CurrentTransportState } = await this.av('GetTransportInfo');
      if (playbackOf(CurrentTransportState) !== PLAYBACK.STOPPED) {
        await this.stop();
      }
    } catch {
      // Best effort: SetAVTransportURI below tells whether it worked.
    }
    await this.setUri(url, metadata);
    await this.play();
  }

  /** Whether the renderer reaches PLAYING within `playWait.timeoutMs`. */
  async waitForPlayback() {
    const { timeoutMs, intervalMs } = this.playWait;
    for (let waited = 0; ; waited += intervalMs) {
      try {
        const { CurrentTransportState } = await this.av('GetTransportInfo');
        if (CurrentTransportState === 'PLAYING') return true;
      } catch {
        // A renderer busy loading may not answer: ask again.
      }
      if (waited >= timeoutMs) return false;
      await this.sleep(intervalMs);
    }
  }

  /**
   * Play a URL now and make sure it plays. A renderer may accept the URL and
   * Play (both answer 200) yet stay STOPPED: the real Denon AVR-S650H does so
   * with every https stream, and plays the same stream in http. So an https
   * URL that does not start is tried once in http; when nothing plays, the
   * caller gets a clear error instead of a silent success.
   * With `verify: false`, the call returns once Play is accepted (a device
   * command must be acknowledged within 5 s): use `ensurePlaying` afterwards.
   * Resolves the URL that plays.
   */
  async playUrl(url, { metadata, title, mime, verify = true } = {}) {
    await this.startUrl(url, metadata ?? buildMetadata({ url, title, mime }));
    return verify ? this.ensurePlaying(url, { metadata, title, mime }) : url;
  }

  async ensurePlaying(url, { metadata, title, mime } = {}) {
    if (await this.waitForPlayback()) return url;
    const fallback = httpVariant(url);
    if (fallback) {
      const fallbackMetadata = metadata
        ? metadata.split(escapeXml(url)).join(escapeXml(fallback))
        : buildMetadata({ url: fallback, title, mime });
      await this.startUrl(fallback, fallbackMetadata);
      if (await this.waitForPlayback()) return fallback;
    }
    throw new PlaybackNotStartedError(url);
  }

  /** Volume as a percentage of the range the renderer declares. */
  async getVolume() {
    const { CurrentVolume } = await this.rc('GetVolume');
    const { minimum, maximum } = this.volumeRange;
    const raw = Number(CurrentVolume);
    if (!Number.isFinite(raw)) return null;
    return Math.round(
      ((Math.min(Math.max(raw, minimum), maximum) - minimum) / (maximum - minimum)) * 100,
    );
  }

  setVolume(percent) {
    const { minimum, maximum } = this.volumeRange;
    const clamped = Math.min(Math.max(Number(percent) || 0, 0), 100);
    const raw = Math.round(minimum + (clamped / 100) * (maximum - minimum));
    return this.rc('SetVolume', { ...MASTER, DesiredVolume: String(raw) });
  }

  async getMute() {
    const { CurrentMute } = await this.rc('GetMute');
    return CurrentMute === '1' || CurrentMute?.toLowerCase() === 'true';
  }

  setMute(muted) {
    return this.rc('SetMute', { ...MASTER, DesiredMute: muted ? '1' : '0' });
  }

  /** The protocolInfo list the renderer accepts (cached), [] when unknown. */
  async getSink() {
    if (this.sink) return this.sink;
    if (!this.connectionManager?.controlUrl) return [];
    try {
      const { Sink } = await this.call(this.connectionManager, 'GetProtocolInfo', {});
      this.sink = (Sink ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } catch {
      this.sink = [];
    }
    return this.sink;
  }

  /**
   * A full snapshot of the renderer: transport, track, volume, mute. The
   * transport is mandatory (it is what tells the renderer is reachable); the
   * rest is best effort, `null` when the renderer cannot answer.
   */
  async getStatus() {
    const transport = await this.av('GetTransportInfo');
    const optional = (promise) => promise.catch(() => null);
    const [position, volume, muted] = await Promise.all([
      optional(this.av('GetPositionInfo')),
      this.hasVolume ? optional(this.getVolume()) : null,
      this.hasMute ? optional(this.getMute()) : null,
    ]);
    // A web radio often describes itself only in the media metadata.
    const media = parseDidl(position?.TrackMetaData).items[0]?.title
      ? null
      : await optional(this.av('GetMediaInfo'));
    return {
      transportState: transport.CurrentTransportState ?? '',
      playback: playbackOf(transport.CurrentTransportState),
      ...describeMedia(position ?? {}, media ?? {}),
      position: parseDuration(position?.RelTime),
      duration: parseDuration(position?.TrackDuration) || null,
      volume,
      muted,
    };
  }
}
