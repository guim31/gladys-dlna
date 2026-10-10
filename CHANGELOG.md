# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-dlna/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-dlna/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-dlna/releases/tag/v1.0.1
