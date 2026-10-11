# SOAP faults

UPnP errors as a renderer answers them: an HTTP 500 carrying a SOAP `Fault` whose `detail` holds a
`UPnPError` (UPnP Device Architecture 1.0, section 3.2.2), in the envelope layout of the real
Denon AVR-S650H answers of `../devices/denon-avr-s650h/`.

- `fault-701-transition-not-available.xml`: **reconstructed**, not a capture. The AVTransport:1
  code and label ("common error codes") that a Sennheiser AMBEO Soundbar answered to Play while it
  played Spotify, as reported by a user: `Play failed: 701 Transition not available`.
