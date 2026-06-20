# Mattermost Voice Messages

[![CI](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/ci.yml)
[![Release](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/release.yml/badge.svg)](https://github.com/icoretech/mattermost-voice-messages/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/icoretech/mattermost-voice-messages)](https://github.com/icoretech/mattermost-voice-messages/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src=".github/assets/screenshot.png" alt="Mattermost Voice Messages screenshot" width="838" />
</p>

WhatsApp-style voice messages for Mattermost channels and threads.

The plugin adds a microphone button to Mattermost web and desktop. Users can record a short audio message, listen to it before sending, and post it in a channel or thread.

People reading from Mattermost web, desktop, or a mobile browser get the full voice-message player with waveform and speed controls. People reading from the native Mattermost iOS or Android apps get a regular audio attachment they can play with the mobile app's built-in audio player.

## Features

- Record and send voice messages from Mattermost web and desktop
- Listen before sending
- Send voice messages in channels and threads
- Play messages inline on web, desktop, and mobile browser
- Change playback speed: `0.5x`, `1x`, `1.5x`, and `2x`
- Keep received voice messages playable in the native Mattermost mobile apps
- Show the web player for matching audio files uploaded outside the recorder
- Respect existing Mattermost posting and file-upload permissions
- No transcription, speech-to-text, text-to-speech, or server-side audio processing

## Requirements

- Mattermost Server 8.1+
- File uploads enabled in Mattermost
- Users need permission to post messages and upload files in the target channel
- A modern browser with microphone access for recording

The record button is available in Mattermost web, desktop, and mobile browser. Native Mattermost iOS and Android users can listen to received voice messages as audio attachments, but they do not get the plugin's record button.

Voice uploads are limited to 25 MiB and 6 hours. Supported formats are WebM, Ogg, MP4/M4A, MP3, and WAV.

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
2. Click the microphone button next to the composer.
3. Allow microphone access if the browser asks.
4. Stop recording when finished.
5. Review the clip.
6. Click **Send**, or cancel to discard it.

On web, desktop, and mobile browser, sent voice messages show the custom voice player. On native Mattermost mobile apps, they show as regular audio attachments without an extra text label above the player.

## Configuration

There are no plugin settings in `0.1.x`.

Access is inherited from Mattermost permissions:

- Users must be authenticated.
- Users must be members of the target channel.
- Users must have permission to create posts in the channel.
- Users must have permission to upload files in the channel.

## Development

Install build dependencies:

```bash
cd webapp
npm ci
```

Development builds require Go 1.26+ and Node.js 24+.

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
