---
name: mattermost-voice-dev-smoke
description: Boot, provision, and smoke-test the local Mattermost preview stack for this voice-messages plugin. Use when setting up local plugin development, recreating the Mattermost dev server, confirming admin credentials/team provisioning, deploying the plugin to localhost, or running browser smoke checks for recording and playback.
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

## Browser smoke checklist

Use the local Mattermost UI after deployment:

1. login with the provisioned admin
2. open `http://localhost:18065/example-org/channels/town-square`
3. confirm the composer shows the icon-only voice recorder control
4. start recording and allow microphone permission
5. stop recording and confirm the review panel shows the custom Mattermost-skinned player, not native `<audio controls>`
6. send the recording
7. confirm the created post renders the custom voice-message post UI with play/pause, waveform scrubber, elapsed/duration text, and speed buttons
8. click `2x` and confirm its speed button has `aria-pressed="true"`

When browser microphone capture is unavailable, use a tiny valid audio fixture/direct upload only to verify the post renderer. Do not treat invalid fake `MediaRecorder` bytes as playback evidence.

## Local quality gates

Before claiming the smoke harness is ready, run the focused gates touched by this setup:

```bash
docker compose -f docker-compose.dev.yml config
cd webapp && npm run typecheck && npm run biome:ci && npm run react-doctor && npm run test && npm run build
```

Run `make manifest-check`, `go vet ./...`, `go test -race ./...`, and `make dist` when plugin code changed or before packaging.
