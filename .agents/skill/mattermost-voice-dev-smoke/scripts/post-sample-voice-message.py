#!/usr/bin/env python3
import io
import json
import math
import os
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

SITE_URL = os.environ.get("MM_SERVICESETTINGS_SITEURL", "http://localhost:18065").rstrip("/")
ADMIN_USERNAME = os.environ.get("MM_ADMIN_USERNAME", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("MM_ADMIN_PASSWORD", "Password1!")
TEAM_NAME = os.environ.get("MATTERMOST_DEV_TEAM", "example-org")
CHANNEL_NAME = os.environ.get("MATTERMOST_DEV_CHANNEL", "town-square")
DURATION_MS = int(os.environ.get("VOICE_SAMPLE_DURATION_MS", "1000"))
SAMPLE_RATE = 8000
PLUGIN_ID = "ch.icorete.mattermost-voice-messages"


def request_json(method, path, payload=None, token=None):
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        f"{SITE_URL}{path}", data=body, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read()
            decoded = json.loads(response_body.decode("utf-8")) if response_body else {}
            return decoded, response.headers
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with {error.code}: {detail}") from error


def login():
    _, headers = request_json(
        "POST",
        "/api/v4/users/login",
        {"login_id": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
    )
    token = headers.get("Token")
    if not token:
        raise RuntimeError("login response did not include a Token header")
    return token


def generate_wav(duration_ms):
    frames = max(1, SAMPLE_RATE * duration_ms // 1000)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        for frame in range(frames):
            sample = int(32767 * 0.15 * math.sin(2 * math.pi * 440 * frame / SAMPLE_RATE))
            wav.writeframesraw(struct.pack("<h", sample))
    return output.getvalue()


def multipart_form(fields, file_field, filename, content_type, file_bytes):
    boundary = f"----voice-smoke-{uuid.uuid4().hex}"
    chunks = []
    for key, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("ascii"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    chunks.extend(
        [
            f"--{boundary}\r\n".encode("ascii"),
            (
                f'Content-Disposition: form-data; name="{file_field}"; '
                f'filename="{filename}"\r\n'
            ).encode("ascii"),
            f"Content-Type: {content_type}\r\n\r\n".encode("ascii"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("ascii"),
        ]
    )
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def post_voice_message(token, channel_id, wav_bytes):
    body, content_type = multipart_form(
        {"channel_id": channel_id, "duration_ms": str(DURATION_MS)},
        "audio",
        "voice-message-smoke.wav",
        "audio/wav",
        wav_bytes,
    )
    request = urllib.request.Request(
        f"{SITE_URL}/plugins/{PLUGIN_ID}/api/v1/voice-messages",
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"voice upload failed with {error.code}: {detail}") from error


def main():
    token = login()
    channel, _ = request_json(
        "GET",
        f"/api/v4/teams/name/{urllib.parse.quote(TEAM_NAME)}/channels/name/{urllib.parse.quote(CHANNEL_NAME)}",
        token=token,
    )
    response = post_voice_message(token, channel["id"], generate_wav(DURATION_MS))
    post_id = response["post"]["id"]
    file_id = response["file_info"]["id"]
    channel_url = f"{SITE_URL}/{TEAM_NAME}/channels/{CHANNEL_NAME}"
    print(f"post_id={post_id}")
    print(f"file_id={file_id}")
    print(f"channel_url={channel_url}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
