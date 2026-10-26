# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.2.0] - 2026-10-26

### Added

- **Gladys 5.3 music player.** Each renderer now tells the core Music widget what it plays: title,
  artist, album, cover, duration and position (a progress bar you can drag: a seek), plus shuffle,
  repeat and mute. The widget's panel browses and searches the media servers added to Gladys
  (`Search` of the server, or its folders), plays a track, an album, an artist or a playlist, and
  puts media in the play queue (play next, add to queue); the queue panel shows the play queue of
  the integration and jumps to a track. The core scene action "Play music on a speaker" uses the
  same catalog. Requires Gladys 5.3.0.
- Shuffle and repeat (off, all, one track) for the play queue of the integration.
- Covers: the album art of the media server (its 160 px variant first); a large cover (several
  megabytes) is made smaller in the container, in plain JavaScript (Gladys accepts 300 KB at most).
- A scene that keeps a media whose server object was renumbered (MiniDLNA rebuilding its database)
  finds it again by its title.

### Changed

- **The playback state is 2 when stopped or when nothing is loaded** (Gladys 5.3), no longer 0: a
  scene "playback state equals 0" now only starts on a pause. It is writable: 0 pauses, 1 plays,
  2 stops; 3 is published while the renderer loads a media.
- Mute becomes the music mute of Gladys 5.3 (same feature): on or off instead of a toggle button.
  For devices added before this version, open the Discovery tab and press **Update** on each
  renderer to get the new features; until then, the mute button toggles as before.
- The "Now playing" text feature stays, next to the new title, artist and album features.
- A renderer that cannot be reached is published as stopped with nothing loaded.
- Pictures of a folder (`cover.jpg`) are no longer queued as tracks when a scene plays a folder.
- A track a media server lists twice (an artist's "- All Albums -" view and each album) is queued
  once.
- Gladys 5.3.0 or later is required (SDK 0.16.0).

## [1.1.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.1.1] - 2026-10-13

### Changed

- Integration SDK 0.15.0 and up-to-date development dependencies.
- Quieter logs: a renderer that plays something else, a repeated background scan or a scene that
  plays a favorite no longer fill the info level; a refusal of Gladys to store the states, or a
  network scan that is unavailable, is logged once when it starts and once when it ends, not on
  every poll. A playback that never started is now logged once as a warning. The URLs of the logs
  no longer show credentials or query strings.
- The renderers keep being polled by the integration itself, independently of the Gladys
  scheduler (GladysAssistant/Gladys#3198): now covered by a test.

## [1.1.0] - 2026-10-11

### Added

- Favorites: up to 8 web radios, files or media server searches (folder, album, playlist…), named in
  the configuration. A new "DLNA favorites" widget plays them in one tap (four per widget, add
  several for more) and shows the favorite playing; a new "Play a DLNA favorite" scene action plays
  one, with an optional volume.
- German and Spanish: every text of the integration (configuration, scene cards, widgets, action
  results, error messages) now exists in English, French, German and Spanish, and the language of
  the feature names and messages can be German or Spanish.

### Changed

- "Play a URL" without a title shows the name of the web radio, read from its ICY headers
  (`icy-name`, or the title on air), instead of the bare URL; the URL stays the last resort. A
  renderer that reports the bare URL, or no title, also shows that name.

## [1.0.4] - 2026-10-11

### Fixed

- A command refused by the renderer now reads as its meaning instead of a raw UPnP error such as
  "Play failed: 701 Transition not available": on a device playing another source (Spotify,
  AirPlay, HDMI…), Play, Pause, Stop, Next and Previous say there is nothing to act on over DLNA
  and point to the app of that source. The codes 402, 501, 702, 704, 705, 714, 715, 716, 718 are
  explained too; the raw code stays in the logs of the integration.
- The widget's Stop no longer answers "Stopped" when no DLNA media was loaded.
- The follow-up of a playback start gives up at once when the renderer lost the media, refuses to
  load it again and refuses Play (701), instead of pressing Play for 75 s.

### Changed

- Docs: volume and mute work whatever the source (Spotify Connect, AirPlay, HDMI…), while the
  playback state and commands only follow DLNA; a Sennheiser AMBEO Soundbar checked by a user.

## [1.0.3] - 2026-10-10

## [1.0.2] - 2026-10-10

### Fixed

- A renderer woken from standby now starts playing: the Denon AVR-S650H ignores Play for up to
  about 50 s while it wakes up, so the integration follows every start for up to 75 s in the
  background, presses Play again every 5 s while the renderer is stopped, restarts a playback cut
  by the source switch, and logs a start that never comes. Scene actions answer as soon as the
  renderer accepted the command.
- An empty artist or album sent as `""` (Denon) is no longer shown as two quotes.

## [1.0.1] - 2026-10-10

### Added

- DLNA / UPnP AV renderers (TV, amplifier, speaker): play, pause, stop, previous, next, volume,
  mute, playback state and the title being played, compatible with the core Music widget and the
  core "Play a notification" scene action.
- Media servers (Plex, Jellyfin, Emby, MiniDLNA…), browsed and searched through `ContentDirectory`.
- Automatic discovery through the network search of Gladys (SSDP), embedded devices included, and
  description URLs typed by hand for the other networks.
- Scene actions "Play a media server on a DLNA renderer" (title, artist, album or folder; in order,
  shuffled or first result) and "Play a URL on a DLNA renderer".
- Scene triggers "DLNA playback started", "paused" and "stopped", filterable by renderer.
- "DLNA player" dashboard widget.
- Configuration actions "Test a description URL" and "Browse a media server".

### Removed

- The demo devices, actions, scenes and widget of the template.

[Unreleased]: https://github.com/guim31/gladys-dlna/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/guim31/gladys-dlna/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/guim31/gladys-dlna/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/guim31/gladys-dlna/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/guim31/gladys-dlna/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/guim31/gladys-dlna/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/guim31/gladys-dlna/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/guim31/gladys-dlna/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-dlna/releases/tag/v1.0.1
