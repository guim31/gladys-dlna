# DLNA for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for **DLNA / UPnP AV**,
100% local:

- **Renderers** (`MediaRenderer`): TVs, amplifiers, speakers, streamers. Each one becomes a Gladys
  device with play, pause, stop, previous, next, volume, mute, playback state and the title being
  played. They work with the core **"Play a notification"** scene action (Gladys Plus
  text-to-speech).
- **Gladys 5.3 music player**: the core **Music** widget shows the cover, title, artist, album and
  progress of each renderer, with seek, shuffle, repeat and mute; its panel browses and searches
  the media servers added to Gladys, plays or queues a track, an album, an artist or a playlist,
  and shows the play queue. The core scene action "Play music on a speaker" uses the same catalog.
- **Media servers** (`MediaServer`): Plex, Jellyfin, Emby, MiniDLNA, a NAS, Kodi… Browsed and
  searched with `ContentDirectory` (`Browse`, and `Search` when the server has it).
- **Scenes**: "Play a media server on a DLNA renderer" (search by title, artist, album or folder;
  everything in order, shuffled, or the first result) and "Play a URL on a DLNA renderer" (web radio,
  sound, announcement; a web radio is named after its ICY `icy-name` header when no title is
  given), and "Play a DLNA favorite". Triggers: playback **started**, **paused**, **stopped**,
  filterable by renderer, with the title, artist and album as variables.
- **Favorites**: up to 8 web radios, files or media server searches, named in the configuration.
- **Dashboard**: a "DLNA player" widget (title, state, live volume, play/pause, stop, volume steps)
  and a "DLNA favorites" widget (four favorites per widget, and the one playing).
- Texts in English, French, German and Spanish, the languages of Gladys.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

_This project is not affiliated with the Digital Living Network Alliance (dissolved) or any device
maker._

## Requirements

- Gladys Assistant **5.3.0** or later (the music player of Gladys 5.3; scene triggers and actions,
  dashboard widgets, mediated network discovery).
- Renderers and servers on the same network as Gladys for automatic discovery; a device on another
  subnet or VLAN can be added by the URL of its UPnP description.
- Albums and folders are queued track by track by the integration, so a renderer plays them only
  while the integration runs.

## Installation

1. In Gladys, open **Integrations**, find **DLNA** and install it.
2. Open the **Discovery** tab: renderers and servers of the network are listed. Add the ones you
   want.
3. Optional: in **Configuration**, pick the language of the feature names and messages before
   adding devices, add description URLs for devices SSDP cannot reach, and fill your favorites.

## How it works

- **Discovery**: the container runs on a Docker bridge network, where SSDP multicast never arrives.
  The Gladys core sends the M-SEARCH on its behalf (manifest `network_discovery`) and relays the raw
  answers; the integration reads every description, embedded devices included (a Denon amplifier
  hides its MediaRenderer and its MediaServer inside a vendor root device, on port 60006).
- **State**: UPnP eventing (GENA) needs the device to call the subscriber back on an HTTP port, and
  the integration container has no inbound port. The integration therefore polls the renderers it
  follows (`GetTransportInfo`, `GetPositionInfo`, `GetVolume`, `GetMute`): every 3 to 5 seconds while
  playing, every 15 seconds when idle, once a minute when the renderer is off (shown with the
  "unreachable" badge). Only the changes are published.
- **Queue**: a DLNA renderer plays one URI at a time. To play an album or a folder, the integration
  preloads the next track with `SetNextAVTransportURI` when the renderer supports it (gapless), or
  starts it when the current one ends. Next / previous walk that queue; shuffle and repeat are its
  modes (UPnP has no standard queue: the play mode of a renderer only applies to its own playlist).
- **Gladys 5.3 music player**: what each renderer plays (`GetPositionInfo` / `GetMediaInfo`
  metadata, completed by what Gladys asked it to play) goes through `publishNowPlaying`, which keeps
  only the changes; the position is a sample, never a stream. The catalog (`music` in the manifest:
  browse, search, queue, append) is the `ContentDirectory` of the media servers added to Gladys
  ([`src/catalog.js`](src/catalog.js)); covers are read from the server's `albumArtURI` (the
  `JPEG_TN` variant for lists) and made smaller in plain JavaScript when Gladys would refuse them
  ([`src/artwork-resize.js`](src/artwork-resize.js), from gladys-mopidy).
- **Devices added before 1.2**: "Update" in the Discovery tab adds the new features and turns the
  mute push button into the music mute (same external id); the playback state is 2 when stopped.
- Runtime dependencies: the Gladys SDK, and the JPEG encoder of `jpeg-js` (covers). The XML reader,
  the SOAP client and the DIDL-Lite handling are a few hundred lines in [`src/upnp/`](src/upnp/).

## Limitations

- Checked for real on a Denon AVR-S650H (playback, pause, volume, mute, stop, browsing of the
  built-in server), and by a user on a Sennheiser AMBEO Soundbar (discovery, volume).
- Media played some other way (Spotify Connect, AirPlay, an HDMI input…): volume and mute still
  work from Gladys, but the playback state, the title and the transport commands only follow what
  is played over DLNA. A renderer in standby can take up to a minute to start: the integration
  follows every start for up to 75 s in the background, pressing Play again every 5 s while the
  wake-up ignores it.
- **Sonos, Samsung TV and LG webOS** have their own integrations, which do more than DLNA can
  (grouping, sources, apps). DLNA still works on them, for playing media and announcements.
- Covers appear in the core Music widget only, not in the "DLNA player" widget of the
  integration.
- Shuffle and repeat apply to the play queue of the integration (what Gladys plays), not to media
  started by another app.
- The core "Play a notification" action does not pass its volume to external integrations: the
  announcement plays at the current volume. The "Play a URL" scene action has a volume field.
- After an announcement, the previous media is not resumed.
- Search quality depends on the server: when it has no `Search`, the integration crawls its folders
  (bounded to a few hundred folders, and stopped after 75 seconds with a clear error).
- Renderers that rewrite the URI of the media (proxies) can confuse the queue: it then stops at the
  end of the current track.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
```

The tests never touch the network: [`test/helpers/fakeNetwork.js`](test/helpers/fakeNetwork.js)
serves the fixtures of [`test/fixtures/devices/`](test/fixtures/devices/) (see its
[README](test/fixtures/devices/README.md)). [`test/gladys-rules.test.js`](test/gladys-rules.test.js)
checks every discovered device against the category/type table of the Gladys core.

Store admission check, from the repository root:

```bash
npx -y github:GladysAssistant/integration-store .
```

Releases are made by the **Release** workflow (Actions → Release): see [`CLAUDE.md`](CLAUDE.md).

## Credits

- [async-upnp-client](https://github.com/StevenLooman/async_upnp_client) by Steven Looman
  (Apache-2.0): several test fixtures (renderer and server descriptions, SCPDs, SOAP answers) come
  from its test suite.
- The [Home Assistant](https://github.com/home-assistant/core) `dlna_dmr` and `dlna_dms`
  integrations (Apache-2.0) served as a reference for the behaviour of real devices.
- The Denon AVR-S650H answers were captured on a real amplifier and anonymized.

## License

[Apache-2.0](LICENSE)
