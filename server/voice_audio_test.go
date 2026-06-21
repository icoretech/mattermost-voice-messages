package main

import (
	"net/http"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseVoiceMessageRequestRejectsUnsupportedAudioBytes(t *testing.T) {
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id": model.NewId(),
	}, "voice.webm", "audio/webm", []byte("not audio"))

	_, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

	require.NotNil(t, handlerErr)
	assert.Equal(t, http.StatusUnsupportedMediaType, handlerErr.status)
	assert.Equal(t, "Unsupported audio type", handlerErr.message)
}

func TestParseVoiceMessageRequestRejectsDeclaredDetectedAudioMismatch(t *testing.T) {
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id": model.NewId(),
	}, "voice.webm", "audio/webm", validWAVAudioBytes())

	_, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

	require.NotNil(t, handlerErr)
	assert.Equal(t, http.StatusUnsupportedMediaType, handlerErr.status)
	assert.Equal(t, "Unsupported audio type", handlerErr.message)
}

func TestParseVoiceMessageRequestAcceptsSupportedAudioSignatures(t *testing.T) {
	testCases := []struct {
		name        string
		contentType string
		audio       []byte
		mimeType    string
	}{
		{name: "webm", contentType: "audio/webm;codecs=opus", audio: validWebMAudioBytes(), mimeType: "audio/webm"},
		{name: "ogg", contentType: "audio/ogg", audio: []byte("OggS\x00"), mimeType: "audio/ogg"},
		{name: "mp4", contentType: "audio/mp4", audio: []byte("\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00"), mimeType: "audio/mp4"},
		{name: "mp3 id3", contentType: "audio/mpeg", audio: []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), mimeType: "audio/mpeg"},
		{name: "mp3 frame", contentType: "audio/mpeg", audio: []byte{0xff, 0xfb, 0x90, 0x64}, mimeType: "audio/mpeg"},
		{name: "wav", contentType: "audio/wav", audio: validWAVAudioBytes(), mimeType: "audio/wav"},
		{name: "wav alias", contentType: "audio/x-wav", audio: validWAVAudioBytes(), mimeType: "audio/x-wav"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := newVoiceMultipartRequest(t, map[string]string{
				"channel_id": model.NewId(),
			}, "voice.audio", tc.contentType, tc.audio)

			parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

			require.Nil(t, handlerErr)
			assert.Equal(t, tc.mimeType, parsed.mimeType)
			assert.Equal(t, tc.audio, parsed.data)
		})
	}
}

func validWebMAudioBytes() []byte {
	return []byte{0x1a, 0x45, 0xdf, 0xa3}
}

func validWAVAudioBytes() []byte {
	return []byte("RIFF\x24\x00\x00\x00WAVE")
}
