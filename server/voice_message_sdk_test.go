package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
)

func TestVoiceMessagePostPreservesAudioMetadataWhenSDKSanitizesProps(t *testing.T) {
	// Given a voice post entering Mattermost's create/update write path.
	fileID := model.NewId()
	post := buildVoiceMessagePost(model.NewId(), voiceMessageRequest{
		channelID:  model.NewId(),
		durationMS: 1500,
		mimeType:   "audio/webm",
		waveform:   []any{0.25, 0.75},
		data:       []byte("audio"),
		transcript: "sample transcript",
	}, &model.FileInfo{Id: fileID, Name: "sample.webm"})
	post.AddProp(model.PostPropsFromWebhook, true)
	post.AddProp(model.PostPropsOverrideUsername, "sample-bot")
	post.AddProp(model.PostPropsOverrideIconURL, "https://example.com/icon.png")

	// When the real SDK strips reserved integration identity props.
	post.SanitizeProps()

	// Then the upload and its playback metadata remain usable.
	assert.Equal(t, model.StringArray{fileID}, post.FileIds)
	assert.Equal(t, "sample transcript", post.Message)
	assert.Equal(t, model.StringInterface{
		"voice_message": map[string]any{
			"version":     1,
			"file_id":     fileID,
			"filename":    "sample.webm",
			"mime_type":   "audio/webm",
			"duration_ms": int64(1500),
			"size":        int64(5),
			"waveform":    []any{0.25, 0.75},
		},
	}, post.GetProps())
}
