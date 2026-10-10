# DLNA

Control the DLNA / UPnP renderers of your home (TV, amplifier, speaker, streamer) and play the
content of your media servers (Plex, Jellyfin, Emby, MiniDLNA, a NAS…) from Gladys. Everything stays
on your local network: no account, no cloud.

## Requirements

- Gladys 5.1.0 or later.
- The renderers and servers on the same network as Gladys. A device on another network (VLAN, other
  subnet) can be added by hand, see below.
- On a renderer, DLNA must be enabled: it is sometimes called "DLNA", "UPnP", "Media renderer",
  "Play to" or "AllShare" in its settings, and some TVs only answer when they are on (not in
  standby).

## Adding your devices

1. Install the integration, then open its **Discovery** tab: Gladys searches the network and lists
   the renderers and the media servers it found. Run the search again with the button if a device is
   missing (a TV must be on).
2. Add the devices you want. A **renderer** gets the playback commands; a **media server** gets no
   feature, but it then appears in the scene actions.
3. Some devices are both: a Denon amplifier, for instance, is a renderer and a small media server.
   The server is then listed with "(media server)" after its name.

**Language of the feature names**: Gladys keeps the names of a device once it is added. Pick the
language in **Configuration** before adding the devices.

**A device that is not found**: SSDP discovery only works on the network of Gladys. Find the URL
of the UPnP description of the device (in the documentation of the device or the server: MiniDLNA serves
`http://<address>:8200/rootDesc.xml`, a Denon/HEOS amplifier
`http://<address>:60006/upnp/desc/aios_device/aios_device.xml`). Check it with the **Test a
description URL** action, then add it to **Description URLs** in the configuration and run the
search again.

## The renderer device

| Feature        | What it does                                                     |
| -------------- | ---------------------------------------------------------------- |
| Play, Pause    | Starts or resumes, pauses (stops when the renderer cannot pause) |
| Stop           | Stops the playback                                               |
| Previous, Next | Previous or next track (of the queue, see below)                 |
| Volume         | 0 to 100 %, mapped to the range the renderer declares            |
| Mute           | Toggles mute                                                     |
| Playback state | 1 while playing, 0 otherwise (paused, stopped, off)              |
| Now playing    | "Artist — Title" as the renderer describes it, "—" when nothing  |
| Notification   | Used by the core "Play a notification" scene action              |

Volume and Mute only appear when the renderer has them. The device works with the core **Music**
widget of the dashboard (previous, play/pause, next, volume).

The state is refreshed every few seconds while playing, every 15 seconds otherwise. A renderer
that is off shows the **unreachable** badge and is checked once a minute; when it comes back on
another address, the integration finds it again by itself (a network search, at most every 5
minutes).

## Scenes

**Triggers**

- **DLNA playback started**, **DLNA playback paused**, **DLNA playback stopped**: pick a renderer,
  or leave it empty for any. The following actions can use `{{triggerEvent.data.renderer}}`,
  `{{triggerEvent.data.title}}`, `{{triggerEvent.data.artist}}` and `{{triggerEvent.data.album}}`.
  Typical use: dim the lights when the TV starts playing a film, turn them back on when it stops.
  A renderer that is switched off fires nothing (it is not a "stop"), and neither does the short
  gap between two tracks of a queue.

**Actions**

- **Play a media server on a DLNA renderer**: pick the renderer and the server, then what to
  search:
  - _Anything_: titles, artists and albums containing the text, then a folder of that name;
  - _Title_, _Artist_, _Album_ (an album plays in track order);
  - _Folder_: a folder name (`Jazz`), or a path from the root of the server (`Music/Jazz`). The
    tracks of its sub-folders are included. Use the **Browse a media server** action of the
    configuration to find the paths.

  Then choose to play everything in order, everything shuffled, or the first result only, and
  optionally a volume. A search that takes more than 75 seconds (a huge library on a server that cannot search) stops with an error: give a narrower one, such as a folder path. The action returns whether something was found, the number of tracks queued
  and the first title, for the following actions.

- **Play a URL on a DLNA renderer**: a web radio, a sound or an announcement file, by its http(s)
  URL, with an optional title and volume. The URL must be reachable by the renderer itself.

**Queue**: a DLNA renderer plays one media at a time. For an album or a folder, the integration
keeps the list and hands the tracks over one after the other (without a gap when the renderer
supports it). Next and Previous walk the list. The queue stops when something else is played on
the renderer, and it only advances while Gladys and the integration run.

**Announcements**: the core **Play a notification** action works on the renderers (it needs Gladys
Plus for the text-to-speech). It plays at the current volume (the core does not pass its volume to
the integrations), and the previous media is not resumed afterwards. To set the volume of an
announcement, place a device control action on its Volume feature before it.

## Dashboard

Add the **DLNA player** widget and pick a renderer in its settings: it shows the title, the album,
the state, the queue position, mute, a live volume gauge, and four buttons (play/pause, stop,
volume − and +, by steps of 5 %).

## Configuration actions

- **Test a description URL**: reads a description URL and tells what it holds.
- **Browse a media server**: lists the folders and tracks of a server, from the root or from a
  path (`Music/Albums`).

## Sonos, Samsung, LG

Sonos speakers, Samsung TVs and LG webOS TVs have their own Gladys integrations, which do more than
DLNA (groups, sources, applications). This integration still sees them when they offer DLNA: it is
useful to play media from a server or announcements, next to their own integration.

## What has been checked on real hardware

- **Checked for real on a Denon AVR-S650H** (playback, pause, volume, mute, stop, browsing of the
  built-in server): an http stream plays, the position advances, pause and resume work, the volume
  set in Gladys is the volume of the amplifier (15 in Gladys is MV15), mute is set and read back,
  stop stops, and the built-in media server is browsed. The amplifier wakes from standby by itself
  on a command. Its description, service descriptions and state answers are replayed by the tests.
- **https streams on the Denon**: it accepts an https URL and then never plays it, while the same
  stream in http plays at once. The integration therefore checks that playback really starts; an
  https URL that does not start is tried once in http, and when nothing plays the scene action
  fails with a clear message ("the renderer did not start playing: it may not accept https URLs").
- **Not checked on real hardware yet**: the play queue and its gapless transitions, the network
  search run by Gladys, and searching a real media server (MiniDLNA, Plex, Jellyfin). They are
  covered by tests on simulated devices built from public formats. Please report any device that
  misbehaves, with the logs of the integration.

## Troubleshooting

- **Nothing in the Discovery tab**: check that the devices are on and on the same network as
  Gladys; read the logs of the integration (`Discovery: N SSDP answer(s)…`). Add a description URL
  by hand otherwise.
- **A command fails with "701"** (transition not available): the renderer refuses this command in
  its current state, for instance Play with nothing loaded.
- **A file or a radio does not play**: the renderer must support its format, and reach its URL
  itself. Many renderers only play `http`: the integration retries an `https` URL in `http` by
  itself, but some streams only exist in `https`.
