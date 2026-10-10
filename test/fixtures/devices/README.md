# Device fixtures

Each folder is one UPnP device of the fake LAN the tests run on (`test/helpers/fakeNetwork.js`).
Its `fixture.json` gives the description URL, the files served at each path and the recorded SOAP
answers. All addresses are documentation addresses (`192.0.2.0/24`, RFC 5737).

| Folder               | Origin                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `denon-avr-s650h`    | **Real capture** of a Denon AVR-S650H (read-only requests, amplifier stopped), anonymized  |
| `aup-dmr`            | async-upnp-client test fixtures: a renderer root device, its SCPDs and SOAP answers        |
| `aup-dmr-embedded`   | async-upnp-client test fixtures: a renderer embedded in a vendor root device               |
| `aup-dms`            | async-upnp-client test fixtures: a media server and its Browse answers (MiniDLNA-like)     |
| `samsung-tv`         | Reconstructed from the public format of Samsung Tizen TVs; not a capture                   |
| `volumio-upmpdcli`   | Reconstructed from the public format of upmpdcli (`URLBase`, relative URLs); not a capture |
| `minidlna`           | Reconstructed from the public format of MiniDLNA 1.3 (description, search capabilities)    |
| `plex`               | Reconstructed from the public format of Plex Media Server; not a capture                   |
| `synthetic-renderer` | Synthetic: a minimal renderer without mute nor pause, with a 0-60 volume range             |

The `aup-*` files come unchanged from the test suite of
[async-upnp-client](https://github.com/StevenLooman/async_upnp_client) (commit `45f508f`), by Steven
Looman, under the Apache License 2.0.
