# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-dlna/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-dlna/releases/tag/v1.0.1
