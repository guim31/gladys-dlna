# Denon AVR-S650H — real DLNA MediaRenderer responses

Captured on 10 October 2026 from a real Denon AVR-S650H (HEOS / Aios firmware 3.139.173), with
**read-only** requests only: the device description, the four service descriptions (SCPD) of its
embedded `MediaRenderer:1`, and the SOAP answers of `GetTransportInfo`, `GetPositionInfo`,
`GetMediaInfo`, `GetTransportSettings`, `GetVolume`, `GetMute` and `GetProtocolInfo`, the
amplifier being stopped.

Anonymized: UDNs, serial number, MAC addresses and IP addresses are replaced by placeholders
(`192.0.2.10` is a documentation address). Nothing else was changed.

Note: the MediaRenderer is an **embedded device** of a vendor root device
(`urn:schemas-denon-com:device:AiosDevice:1`), and the description is served on port 60006, not
on the HTTP port of the web UI.
