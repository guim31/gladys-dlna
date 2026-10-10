# DLNA for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for **DLNA / UPnP AV**,
100% local:

- **Renderers** (`MediaRenderer`): TVs, amplifiers, speakers, streamers. Each one becomes a Gladys
  device with play, pause, stop, previous, next, volume, mute, playback state and the title being
  played. They work with the core **Music** dashboard widget and the core **"Play a notification"**
  scene action (Gladys Plus text-to-speech).
- **Media servers** (`MediaServer`): Plex, Jellyfin, Emby, MiniDLNA, a NAS, Kodi… Browsed and
  searched with `ContentDirectory` (`Browse`, and `Search` when the server has it).
- **Scenes**: "Play a media server on a DLNA renderer" (search by title, artist, album or folder;
  everything in order, shuffled, or the first result) and "Play a URL on a DLNA renderer" (web radio,
  sound, announcement). Triggers: playback **started**, **paused**, **stopped**, filterable by
  renderer, with the title, artist and album as variables.
- **Dashboard**: a "DLNA player" widget (title, state, live volume, play/pause, stop, volume steps).

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

_This project is not affiliated with the Digital Living Network Alliance (dissolved) or any device
maker._

## Requirements

- Gladys Assistant **5.1.0** or later (scene triggers and actions, dashboard widgets, mediated
  network discovery).
- Renderers and servers on the same network as Gladys for automatic discovery; a device on another
  subnet or VLAN can be added by the URL of its UPnP description.
- Albums and folders are queued track by track by the integration, so a renderer plays them only
  while the integration runs.

## Installation

1. In Gladys, open **Integrations**, find **DLNA** and install it.
2. Open the **Discovery** tab: renderers and servers of the network are listed. Add the ones you
   want.
3. Optional: in **Configuration**, pick the language of the feature names before adding devices,
   and add description URLs for devices SSDP cannot reach.

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
  starts it when the current one ends. Next / previous walk that queue.
- No runtime dependency besides the Gladys SDK: the XML reader, the SOAP client and the DIDL-Lite
  handling are a few hundred lines in [`src/upnp/`](src/upnp/).

## Limitations

- **Sonos, Samsung TV and LG webOS** have their own integrations, which do more than DLNA can
  (grouping, sources, apps). DLNA still works on them, for playing media and announcements.
- No album art in the widget (images would need resizing in the container).
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
