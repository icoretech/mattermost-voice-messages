---
name: mattermost-voice-dev-smoke
description: Boot, provision, and smoke-test the local Mattermost preview stack for this voice-messages plugin. Use when setting up local plugin development, recreating the Mattermost dev server, confirming admin credentials/team provisioning, deploying the plugin to localhost, running browser recording/playback checks, or verifying native/mobile-browser voice fallback behavior.
---

# Mattermost Voice Dev Smoke

## Dev stack

Use `docker-compose.dev.yml` from the repository root. It runs `mattermost/mattermost-preview:latest` on `linux/amd64`, publishes `${MATTERMOST_DEV_PORT:-18065}:8065`, and persists both Mattermost data and bundled Postgres data with named Docker volumes.

Default local URL:

```text
http://localhost:18065
```

Default provisioned account:

```text
admin@example.com / Password1!
```

Default team:

```text
Example Org (example-org)
```

## Bootstrap workflow

From the repository root, run the bundled helper:

```bash
.agents/skill/mattermost-voice-dev-smoke/scripts/bootstrap-dev-mattermost.sh
```

The script:

1. runs `docker compose -f docker-compose.dev.yml up -d`
2. waits for `/api/v4/system/ping`
3. creates the first admin through `POST /api/v4/users` when login fails
4. logs in through `POST /api/v4/users/login`
5. creates the `example-org` team if missing
6. prints the exact `make deploy` command

Override these env vars only when needed:

```bash
MATTERMOST_DEV_PORT=18066
MATTERMOST_DEV_SITE_URL=http://localhost:18066
MM_ADMIN_USERNAME=admin@example.com
MM_ADMIN_PASSWORD='Password1!'
MM_ADMIN_USER=admin
MATTERMOST_DEV_TEAM=example-org
MATTERMOST_DEV_TEAM_DISPLAY='Example Org'
COMPOSE_FILE=docker-compose.dev.yml
```

If the older ad-hoc container `mm-voice-messages-test` is still using port `18065`, either keep using it directly or start this compose stack with `MATTERMOST_DEV_PORT=18066 MATTERMOST_DEV_SITE_URL=http://localhost:18066`.

## Deploy workflow

Build and deploy through the repository Makefile after the stack is reachable:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
make deploy
```

Do not stop or delete an already-running Mattermost dev instance unless the user explicitly asks. Prefer updating/reusing it so existing smoke-test data survives.

## Sample voice post helper

Use the deterministic helper when desktop microphone capture is unavailable or when mobile/native fallback needs a known playable post:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
.agents/skill/mattermost-voice-dev-smoke/scripts/post-sample-voice-message.py
```

The helper logs in, resolves the configured team/channel, generates an in-memory mono 16-bit PCM WAV at 8000 Hz with a quiet 440 Hz tone, posts it through `/plugins/ch.icorete.mattermost-voice-messages/api/v1/voice-messages`, and prints the created post id, file id, and channel URL.

Env vars:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065
MM_ADMIN_USERNAME=admin@example.com
MM_ADMIN_PASSWORD='Password1!'
MATTERMOST_DEV_TEAM=example-org
MATTERMOST_DEV_CHANNEL=town-square
VOICE_SAMPLE_DURATION_MS=1000
```

## Browser smoke checklist

Use the local Mattermost UI after deployment:

1. login with the provisioned admin
2. open `http://localhost:18065/example-org/channels/town-square`
3. confirm the composer shows the icon-only voice recorder control
4. start recording and allow microphone permission
5. stop recording and confirm the review panel shows the custom Mattermost-skinned player, not native `<audio controls>`
6. send the recording
7. confirm the created post is a normal Mattermost post with an empty message, one audio file attachment, and `props.voice_message`
8. confirm the custom player renders underneath through the post attachment component with play/pause, waveform scrubber, elapsed/duration text, and speed buttons
9. confirm Mattermost's default file preview is hidden for that voice post while the custom player is visible
10. click `2x` and confirm its speed button has `aria-pressed="true"`

When browser microphone capture is unavailable, use the sample voice post helper only to verify post rendering. Do not treat invalid fake `MediaRecorder` bytes as playback evidence.

## Mobile emulator smoke checklist

Native Mattermost mobile apps do not load this plugin's webapp bundle. Expected native behavior: the plugin microphone button is absent, and voice messages appear as ordinary posts with audio attachments. Mobile web still loads the plugin UI and should show the custom player.

Android mobile web:

```bash
adb reverse tcp:18065 tcp:18065
scripts/boot-android-emulator.sh \
  "http://localhost:18065/example-org/channels/town-square"
adb exec-out screencap -p > /tmp/android-voice-fallback.png
```

Use `adb reverse` first so Android Chrome can use `http://localhost:18065`, matching the dev stack SiteURL. Fall back to `http://10.0.2.2:18065` only if reverse is unavailable, and record any SiteURL/file URL mismatch observed.

Android native app contingency: if package `com.mattermost.rn` is installed or installable in the AVD, open it, connect to `http://localhost:18065`, log in as `admin@example.com` / `Password1!`, and confirm the plugin mic button is absent while the sample voice post is visible as a normal post with a playable/openable audio attachment.

iOS Safari mobile web:

```bash
scripts/boot-ios-simulator.sh \
  "http://localhost:18065/example-org/channels/town-square"
xcrun simctl io booted screenshot /tmp/ios-voice-fallback.png
```

iOS native app contingency: first check whether a simulator Mattermost build exists:

```bash
xcrun simctl get_app_container booted com.mattermost.rn
```

If it exists, launch it with `xcrun simctl launch booted com.mattermost.rn`, connect to `http://localhost:18065`, log in, and confirm the plugin mic button is absent while the sample voice post is visible as a normal post with a playable/openable audio attachment. If no simulator build is installed, native iOS app smoke is unverified because iOS Simulator cannot install App Store builds; run iOS Safari mobile-web smoke and record that boundary explicitly.

## Local quality gates

Before claiming the smoke harness is ready, run the focused gates touched by this setup:

```bash
docker compose -f docker-compose.dev.yml config
cd webapp && npm run typecheck && npm run biome:ci && npm run react-doctor && npm run test && npm run build
```

Run `make manifest-check`, `go vet ./...`, `go test -race ./...`, and `make dist` when plugin code changed or before packaging.
