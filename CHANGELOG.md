# Changelog

## [0.3.3](https://github.com/icoretech/mattermost-voice-messages/compare/v0.3.2...v0.3.3) (2026-10-21)


### Dependencies

* update Biome, Go modules, and build tooling ([537fb04](https://github.com/icoretech/mattermost-voice-messages/commit/537fb040433b807584195308712d34cd085d489a))
* update dependency sass-embedded to v1.106.0 ([#44](https://github.com/icoretech/mattermost-voice-messages/issues/44)) ([9d7c94e](https://github.com/icoretech/mattermost-voice-messages/commit/9d7c94ec4c056f14e0397227a040685b209228c2))
* update dependency vite to v8.3.5 ([#46](https://github.com/icoretech/mattermost-voice-messages/issues/46)) ([9b95e0d](https://github.com/icoretech/mattermost-voice-messages/commit/9b95e0d3c722cd1e504f5f1d75a3eaa01821d77c))

## [0.3.2](https://github.com/icoretech/mattermost-voice-messages/compare/v0.3.1...v0.3.2) (2026-10-20)


### Bug Fixes

* include session CSRF token in voice uploads ([5c166de](https://github.com/icoretech/mattermost-voice-messages/commit/5c166de69f4b9f32199fa4a76f1b20495802b426))


### Dependencies

* update go module directive to v1.27.3 ([#40](https://github.com/icoretech/mattermost-voice-messages/issues/40)) ([eec7db3](https://github.com/icoretech/mattermost-voice-messages/commit/eec7db39ab4040407cb90da752f9f6a774eed452))

## [0.3.1](https://github.com/icoretech/mattermost-voice-messages/compare/v0.3.0...v0.3.1) (2026-10-19)


### Bug Fixes

* render project links in Mattermost 12 settings ([04ba651](https://github.com/icoretech/mattermost-voice-messages/commit/04ba6519f96ebd3553ce9fe6ff3b6247a00cac44))

## [0.3.0](https://github.com/icoretech/mattermost-voice-messages/compare/v0.2.2...v0.3.0) (2026-10-19)


### Features

* configure voice recording size and duration limits ([297a381](https://github.com/icoretech/mattermost-voice-messages/commit/297a381b0a6a914567026ea332e94ef11b210e76))


### Bug Fixes

* keep model credits out of the recording popover ([e75db40](https://github.com/icoretech/mattermost-voice-messages/commit/e75db4058a625de200db059ebb21121c6d0a91ae))
* stabilize recording preview and transcription feedback ([c0fd68d](https://github.com/icoretech/mattermost-voice-messages/commit/c0fd68de65633ca4817e6f142ce4df4cdc72a692))
* transcribe parakeet recordings without silence padding ([776563a](https://github.com/icoretech/mattermost-voice-messages/commit/776563aa753c97e16d2f2fb35840c064c60094f0))


### Dependencies

* update dependency jsdom to v30.1.3 ([#35](https://github.com/icoretech/mattermost-voice-messages/issues/35)) ([b372ffa](https://github.com/icoretech/mattermost-voice-messages/commit/b372ffaf04a2a7aba00b7c26587e60e292eceb8e))
* update dependency node to v24.22.0 ([#34](https://github.com/icoretech/mattermost-voice-messages/issues/34)) ([5696b10](https://github.com/icoretech/mattermost-voice-messages/commit/5696b10263c14718acb3d98f964d8b1e2138e277))
* update dependency sass-embedded to v1.105.2 ([#37](https://github.com/icoretech/mattermost-voice-messages/issues/37)) ([fab38f4](https://github.com/icoretech/mattermost-voice-messages/commit/fab38f4a42524bfbfc8970c917007c530bd3a65c))
* update dependency vitest to v5.0.5 ([#36](https://github.com/icoretech/mattermost-voice-messages/issues/36)) ([ee2496c](https://github.com/icoretech/mattermost-voice-messages/commit/ee2496cd44cc3a32a1b4d863ac865d05612cc027))
* update react-ecosystem to v19.3.1 ([#32](https://github.com/icoretech/mattermost-voice-messages/issues/32)) ([addb84d](https://github.com/icoretech/mattermost-voice-messages/commit/addb84d276b58fa4b13c6625ca6d5dfab1b477d9))
* upgrade browser-whisper to v2 with model migration ([2573baf](https://github.com/icoretech/mattermost-voice-messages/commit/2573baf8fa9e1a78f5b292909881d3d02ee5885f))


### Documentation

* add product update and repository links ([154efd0](https://github.com/icoretech/mattermost-voice-messages/commit/154efd0802e36500263e3d3b1a9d5d78c63fe9d4))


### Miscellaneous Chores

* release 0.3.0 ([3c3e4b8](https://github.com/icoretech/mattermost-voice-messages/commit/3c3e4b83d0714e4a59ee5e40087a7ae5c6a17bc9))

## [0.2.2](https://github.com/icoretech/mattermost-voice-messages/compare/v0.2.1...v0.2.2) (2026-10-13)


### Features

* add Parakeet client transcription model ([0bfaa5e](https://github.com/icoretech/mattermost-voice-messages/commit/0bfaa5ec46f3af7751eb47e1c1fcb9242415c749))


### Documentation

* describe hosted client transcription requirements ([1094dfe](https://github.com/icoretech/mattermost-voice-messages/commit/1094dfe592ab5679e1fcf7cefa787f6cc3acf48a))
* document real transcription smoke evidence ([2cea02a](https://github.com/icoretech/mattermost-voice-messages/commit/2cea02a531c399d8c787b54a870f36d226079436))

## [0.2.1](https://github.com/icoretech/mattermost-voice-messages/compare/v0.2.0...v0.2.1) (2026-10-13)


### Dependencies

* refresh voice dependencies and verify SDK post sanitization ([2e25b46](https://github.com/icoretech/mattermost-voice-messages/commit/2e25b4687795f8ccc38f5e97a4f9a9181d8dc10f))
* update dependency @types/node to v26.6.4 ([#18](https://github.com/icoretech/mattermost-voice-messages/issues/18)) ([f9103de](https://github.com/icoretech/mattermost-voice-messages/commit/f9103de35b989882569fa6952eb0391802996432))
* update dependency @types/node to v26.6.5 ([#25](https://github.com/icoretech/mattermost-voice-messages/issues/25)) ([4310f42](https://github.com/icoretech/mattermost-voice-messages/commit/4310f42e89416ba35a75c19c65966a3bf161e444))
* update dependency @vitejs/plugin-react to v6.1.2 ([#21](https://github.com/icoretech/mattermost-voice-messages/issues/21)) ([753d0d6](https://github.com/icoretech/mattermost-voice-messages/commit/753d0d631e8899856bc625937c2f6af228412791))
* update dependency browser-whisper to v1.1.1 ([#26](https://github.com/icoretech/mattermost-voice-messages/issues/26)) ([7e36cf2](https://github.com/icoretech/mattermost-voice-messages/commit/7e36cf26e86df668bb84a63685981403cdd941d9))
* update dependency browser-whisper to v1.2.0 ([#27](https://github.com/icoretech/mattermost-voice-messages/issues/27)) ([293ff85](https://github.com/icoretech/mattermost-voice-messages/commit/293ff850108d2d065cc1c7c97a5323a231254a4f))
* update dependency jsdom to v30.1.2 ([#20](https://github.com/icoretech/mattermost-voice-messages/issues/20)) ([47327c6](https://github.com/icoretech/mattermost-voice-messages/commit/47327c692e63a28b6f65b52cb79eecd3c677c7bf))
* update dependency react-doctor to v0.9.17 ([#12](https://github.com/icoretech/mattermost-voice-messages/issues/12)) ([093fe9b](https://github.com/icoretech/mattermost-voice-messages/commit/093fe9b594a1be9ea145e9e9ce00239829350045))
* update dependency react-doctor to v0.9.18 ([#30](https://github.com/icoretech/mattermost-voice-messages/issues/30)) ([c5c11d1](https://github.com/icoretech/mattermost-voice-messages/commit/c5c11d13d9a31450f1e175a146a80eeedfbe2032))
* update dependency vite to v8.3.3 ([#22](https://github.com/icoretech/mattermost-voice-messages/issues/22)) ([efe4ffb](https://github.com/icoretech/mattermost-voice-messages/commit/efe4ffb5cd7033bd15b02389b63887f5b9057e0a))
* update dependency vite to v8.3.4 ([#23](https://github.com/icoretech/mattermost-voice-messages/issues/23)) ([837de89](https://github.com/icoretech/mattermost-voice-messages/commit/837de896711f68c428a346c44a5bd8b5022025ad))
* update dependency vitest to v5.0.4 ([#28](https://github.com/icoretech/mattermost-voice-messages/issues/28)) ([9b9e7cf](https://github.com/icoretech/mattermost-voice-messages/commit/9b9e7cf08457d2f916d425f57bc6a35b8596e5cf))
* update go module directive to v1.27.2 ([#24](https://github.com/icoretech/mattermost-voice-messages/issues/24)) ([b6d12b9](https://github.com/icoretech/mattermost-voice-messages/commit/b6d12b9932882a906debd117f64fb0c3f1ba201b))
* update module github.com/mattermost/mattermost/server/public to v0.5.0 ([#29](https://github.com/icoretech/mattermost-voice-messages/issues/29)) ([2a60b54](https://github.com/icoretech/mattermost-voice-messages/commit/2a60b5469732af7046915329f39d9e41e63ddefa))

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
