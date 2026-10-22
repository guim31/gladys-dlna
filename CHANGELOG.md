# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-dlna/compare/v1.1.2...HEAD
[1.1.2]: https://github.com/guim31/gladys-dlna/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/guim31/gladys-dlna/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/guim31/gladys-dlna/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/guim31/gladys-dlna/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/guim31/gladys-dlna/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/guim31/gladys-dlna/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-dlna/releases/tag/v1.0.1
