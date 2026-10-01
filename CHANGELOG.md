# Changelog

## [0.2.0](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.4...v0.2.0) (2026-10-01)


### Bug Fixes

* **player:** reset audio sessions and ignore stale playback completion ([c9a8af2](https://github.com/icoretech/mattermost-voice-messages/commit/c9a8af26368ca9a7a36250dffd85197c2643bb94))
* **recorder:** cancel pending audio work when recordings or drafts change ([43a2837](https://github.com/icoretech/mattermost-voice-messages/commit/43a28373c395b0a3e5464d7186be116beb1407ea))
* **uploads:** remove temporary audio files and reject archived channels ([dcccff6](https://github.com/icoretech/mattermost-voice-messages/commit/dcccff64936b0fd72f15be8afdecf9d4c6ae1c34))


### Dependencies

* update frontend packages, Go modules and CI actions ([669e734](https://github.com/icoretech/mattermost-voice-messages/commit/669e734f53bae9fed326b951ff93dfb8f20d75b1))


### Miscellaneous Chores

* release 0.2.0 ([d9e758b](https://github.com/icoretech/mattermost-voice-messages/commit/d9e758be4e3b115e245521991f21dad8d73d1755))

## [0.1.4](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.3...v0.1.4) (2026-06-21)


### Bug Fixes

* harden voice audio upload validation ([e12bf4b](https://github.com/icoretech/mattermost-voice-messages/commit/e12bf4b6408d63b7cb14bcb3d726769e5253ce90))

## [0.1.3](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.2...v0.1.3) (2026-06-21)


### Features

* add configurable local voice transcription ([b373756](https://github.com/icoretech/mattermost-voice-messages/commit/b3737563eac9bb7e7f7e4d5ef3c4eea9b5f05abd))


### Bug Fixes

* generate manifests before server CI checks ([5cdf293](https://github.com/icoretech/mattermost-voice-messages/commit/5cdf293287c0992ba17550da17c1b7d06d7b4f52))
* preserve multipart parse errors ([531f18b](https://github.com/icoretech/mattermost-voice-messages/commit/531f18b8e8e1188cee2944107939be1f5cc87e9c))

## [0.1.2](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.1...v0.1.2) (2026-06-20)


### Features

* create voice posts as mobile-safe audio attachments ([2ad2c90](https://github.com/icoretech/mattermost-voice-messages/commit/2ad2c90a5356cfc74b647fc9e5e37426f05ff83b))
* prefer mobile-friendly voice recording audio ([53d6584](https://github.com/icoretech/mattermost-voice-messages/commit/53d6584e477d0c02947b91820ae96e1a448ead72))
* render voice attachments on normal posts ([7d83084](https://github.com/icoretech/mattermost-voice-messages/commit/7d83084abcf1a08df933f889998346d09377d46d))

## [0.1.1](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.0...v0.1.1) (2026-06-19)


### Bug Fixes

* handle voice upload close errors ([361cd0d](https://github.com/icoretech/mattermost-voice-messages/commit/361cd0d6fa9fa6dc50e1eca64959f4e66f96a08b))
* keep microphone permission state icon-only ([e587ba3](https://github.com/icoretech/mattermost-voice-messages/commit/e587ba38ee6169f7e303f63e8a63aa585ff252bf))

## [0.1.0](https://github.com/icoretech/mattermost-voice-messages/compare/v0.1.0...v0.1.0) (2026-06-18)


### Features

* initial release ([c21a61d](https://github.com/icoretech/mattermost-voice-messages/commit/c21a61da0a3e37ab315c5e32928b2a97ea4c4767))
