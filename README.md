# Mattermost Voice Messages

[![CI](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/ci.yml)
[![Release](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/release.yml/badge.svg)](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/icoretech/mattermost-voice-messages)](https://github.com/icoretech/mattermost-voice-messages/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src=".github/assets/screenshot.png" alt="Mattermost Voice Messages screenshot" width="803" />
</p>

WhatsApp-style voice messages for Mattermost channels and threads.

The plugin adds a microphone control to the Mattermost composer. Users click to start recording, review the clip, send it as a custom Mattermost post, and play it back with an inline audio player, waveform scrubber, and playback-speed controls.

## Features

- Browser-side voice recording with `MediaRecorder`
- Composer microphone control beside the native send button
- Compact pre-send review chip with play and duration
- Custom voice-message post renderer for channels and threads
- Inline play/pause controls, waveform scrubber, elapsed/duration display, and playback speeds
- Client-side waveform peak extraction stored with the post
- Server-side validation of channel membership, posting permission, upload permission, audio MIME type, size, duration, and waveform shape
- Mattermost file upload integration with the default attachment preview hidden when the custom player renders successfully
- No speech-to-text, text-to-speech, transcription, or server-side audio processing

## Requirements

- Mattermost Server 8.1+
- Go 1.26+ for building the server bundle
- Node.js 24+ for building the webapp bundle
- A browser that supports `MediaRecorder` for recording

Supported upload MIME types:

- `audio/webm`
- `audio/ogg`
- `audio/mp4`
- `audio/mpeg`
- `audio/wav`
- `audio/x-wav`

Voice uploads are limited to 25 MiB and 6 hours.

## Installation

Download the latest plugin bundle from the [Releases](https://github.com/icoretech/mattermost-voice-messages/releases) page and upload the `.tar.gz` file through **System Console > Plugin Management**.

After uploading, enable **Mattermost Voice Messages** from the plugin list.

### Signature verification

Releases include a detached GPG signature (`.tar.gz.sig`). To verify:

```bash
# Import the public key
curl -sL https://raw.githubusercontent.com/icoretech/mattermost-voice-messages/main/assets/signing-key.asc | gpg --import

# Verify the bundle
gpg --verify ch.icorete.mattermost-voice-messages-*.tar.gz.sig ch.icorete.mattermost-voice-messages-*.tar.gz
```

To add the key to your Mattermost server for automatic plugin signature verification:

```bash
mmctl plugin add key assets/signing-key.asc
```

## Usage

1. Open a channel or thread in Mattermost.
2. Click the microphone button near the composer send button to start recording.
3. Click stop to finish recording.
4. Review the compact preview chip.
5. Click **Send** to post the voice message, or cancel to discard it.

Sent voice messages render as a custom player. The post player includes a waveform scrubber and playback speeds: `0.5x`, `1x`, `1.5x`, and `2x`.

## Configuration

There are no plugin settings in `0.1.x`.

Access is inherited from Mattermost permissions:

- Users must be authenticated.
- Users must be members of the target channel.
- Users must have permission to create posts in the channel.
- Users must have permission to upload files in the channel.

## Development

Install dependencies:

```bash
cd webapp
npm ci
```

Build the plugin bundle:

```bash
make dist
```

The bundle is written to:

```text
dist/ch.icorete.mattermost-voice-messages-<version>.tar.gz
```

### Local Mattermost preview stack

A Docker Compose development stack is included:

```bash
docker compose -f docker-compose.dev.yml up -d
```

By default it serves Mattermost at:

```text
http://localhost:18065
```

Deploy to a running local or remote Mattermost server with:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='password' \
make deploy
```

`make deploy` builds the plugin, uploads the bundle through the Mattermost API, and enables it.

Personal access token authentication is also supported:

```bash
MM_SERVICESETTINGS_SITEURL=https://mattermost.example.com \
MM_ADMIN_TOKEN='personal-access-token' \
make deploy
```

## Quality gates

Run the same checks used by CI:

```bash
make apply
make manifest-check
go vet ./...
go test -race ./...
npm --prefix webapp run typecheck
npm --prefix webapp run biome:ci
npm --prefix webapp run react-doctor
npm --prefix webapp run test
npm --prefix webapp run build
make dist
```

`npm --prefix webapp run lint` runs Biome in write mode, TypeScript type checking, and React Doctor.

## Release

Releases are managed with release-please. The release workflow builds the Mattermost plugin bundle, signs it with the configured organization GPG secret, and uploads both the bundle and detached signature to the GitHub release.

## Security

Please report vulnerabilities through GitHub Security Advisories. If advisories are unavailable, open a minimal issue without sensitive details so maintainers can arrange a private channel.

## License

[MIT](LICENSE) - iCoreTech, Inc.
