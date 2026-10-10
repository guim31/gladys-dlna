// -----------------------------------------------------------------------------
// MediaRenderer client: AVTransport (play, pause, stop, next, previous, the
// media to play) and RenderingControl (volume, mute) of instance 0.
// -----------------------------------------------------------------------------

import { soapCall } from './soap.js';
import { SERVICE_TYPES, findService } from './description.js';
import { buildMetadata, parseDidl, parseDuration } from './didl.js';

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

export class PlaybackNotStartedError extends Error {
  constructor(seconds) {
    super(
      `The renderer did not start playing within ${seconds} s: still waking up, ` +
        'format not supported, or URL not reachable from the renderer',
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
    // How a renderer is followed after Play (see ensurePlaying).
    this.playWait = {
      timeoutMs: 25000, // a renderer in standby takes ~10 s to wake up
      intervalMs: 1000,
      settleMs: 10000, // a playback that ends this soon was cut by the wake-up
      replayGapMs: 3000,
      maxReplays: 2,
    };
    this.now = () => Date.now();
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

  /** The transport state and the loaded URI, or null while the renderer
   * cannot answer (waking up). */
  async readTransport() {
    try {
      const { CurrentTransportState } = await this.av('GetTransportInfo');
      if (!CurrentTransportState) return null;
      const media = await this.av('GetMediaInfo').catch(() => ({}));
      return { state: CurrentTransportState, uri: media.CurrentURI ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * Play a URL now and make sure it plays. Measured on a Denon AVR-S650H in
   * standby: it accepts SetAVTransportURI and Play, answers nothing useful
   * for about 10 s while it wakes up and switches its source, then sits
   * STOPPED with the URI loaded: the Play was lost. And a playback started
   * during the source switch can be cut a few seconds later.
   * With `verify: false`, the call returns once Play is accepted (a device
   * command must be acknowledged within 5 s): use `ensurePlaying` afterwards.
   * Resolves the URL.
   */
  async playUrl(url, { metadata, title, mime, verify = true, cancelled } = {}) {
    const loaded = metadata ?? buildMetadata({ url, title, mime });
    await this.startUrl(url, loaded);
    return verify ? this.ensurePlaying(url, { metadata: loaded, cancelled }) : url;
  }

  /**
   * Follow the renderer after Play until the playback holds: wait while it
   * does not answer, press Play again (at most `maxReplays` times, spaced)
   * when it sits STOPPED without having played, load the URI again if it is
   * no longer ours, and press Play once more if the playback stops within
   * `settleMs` of its start. Throws a PlaybackNotStartedError when nothing
   * plays within `timeoutMs`. `cancelled()` returning true stops the follow
   * (another media or a command came in the meantime: never fight it).
   */
  async ensurePlaying(url, { metadata, title, mime, cancelled = () => false } = {}) {
    const { timeoutMs, intervalMs, settleMs, replayGapMs, maxReplays } = this.playWait;
    const loaded = metadata ?? buildMetadata({ url, title, mime });
    const deadline = this.now() + timeoutMs;
    let lastPress = this.now();
    let replays = 0;
    let restartedAfterDrop = false;
    let playingSince = null;

    const press = async (transport) => {
      lastPress = this.now();
      try {
        if (transport.uri !== url) await this.setUri(url, loaded);
        await this.play();
      } catch {
        // Still busy: the next round looks again.
      }
    };

    for (;;) {
      if (cancelled()) return url;
      const transport = await this.readTransport();
      if (cancelled()) return url;
      const state = playbackOf(transport?.state);
      if (state === PLAYBACK.PLAYING) {
        playingSince ??= this.now();
        if (this.now() - playingSince >= settleMs) return url;
      } else if (state === PLAYBACK.STOPPED) {
        if (playingSince !== null) {
          // Started, then cut (the end of the source switch): once more.
          if (restartedAfterDrop) throw new PlaybackNotStartedError(timeoutMs / 1000);
          restartedAfterDrop = true;
          playingSince = null;
          await press(transport);
        } else if (replays < maxReplays && this.now() - lastPress >= replayGapMs) {
          replays += 1;
          await press(transport);
        }
      }
      if (this.now() >= deadline) {
        if (playingSince !== null) return url;
        throw new PlaybackNotStartedError(timeoutMs / 1000);
      }
      await this.sleep(intervalMs);
    }
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
