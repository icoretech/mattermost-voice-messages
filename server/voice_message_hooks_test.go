package main

import (
	"net/http"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMessageWillBePostedAnnotatesSingleAudioFile(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)

	fileID := model.NewId()
	post := &model.Post{
		Id:      model.NewId(),
		Type:    "",
		FileIds: model.StringArray{fileID},
		Props: model.StringInterface{
			"existing": "kept",
		},
	}
	api.On("GetFileInfo", fileID).Return(&model.FileInfo{Id: fileID, Name: "mobile.m4a", Size: 42, MimeType: "audio/mp4"}, (*model.AppError)(nil))

	updated, rejection := p.MessageWillBePosted(nil, post)

	require.Empty(t, rejection)
	require.NotNil(t, updated)
	assert.Empty(t, updated.Type)
	assert.Equal(t, model.StringArray{fileID}, updated.FileIds)
	assert.Equal(t, "kept", updated.Props["existing"])
	assert.NotContains(t, post.Props, "voice_message")

	voiceMessage, ok := updated.Props["voice_message"].(map[string]any)
	require.True(t, ok)
	assert.Len(t, voiceMessage, 6)
	assert.Equal(t, 1, voiceMessage["version"])
	assert.Equal(t, fileID, voiceMessage["file_id"])
	assert.Equal(t, "mobile.m4a", voiceMessage["filename"])
	assert.Equal(t, "audio/mp4", voiceMessage["mime_type"])
	assert.Equal(t, int64(0), voiceMessage["duration_ms"])
	assert.Equal(t, int64(42), voiceMessage["size"])
	assert.NotContains(t, voiceMessage, "waveform")
	api.AssertExpectations(t)
}

func TestMessageWillBePostedSkipsWhenUploadedAudioPreviewDisabled(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{EnableUploadedAudioPreview: boolPtr(false)})

	updated, rejection := p.MessageWillBePosted(nil, &model.Post{
		Id:      model.NewId(),
		Type:    "",
		FileIds: model.StringArray{model.NewId()},
	})

	assert.Nil(t, updated)
	assert.Empty(t, rejection)
	api.AssertExpectations(t)
}

func TestMessageWillBePostedSkipsNonVoicePosts(t *testing.T) {
	fileID := model.NewId()
	testCases := []struct {
		name      string
		post      *model.Post
		fileInfo  *model.FileInfo
		appErr    *model.AppError
		expectAPI bool
	}{
		{
			name: "nil post",
			post: nil,
		},
		{
			name: "existing voice props",
			post: &model.Post{Type: "", FileIds: model.StringArray{fileID}, Props: model.StringInterface{"voice_message": map[string]any{"version": 1}}},
		},
		{
			name: "custom type",
			post: &model.Post{Type: "custom_other", FileIds: model.StringArray{fileID}},
		},
		{
			name: "zero file ids",
			post: &model.Post{Type: "", FileIds: nil},
		},
		{
			name: "two file ids",
			post: &model.Post{Type: "", FileIds: model.StringArray{fileID, model.NewId()}},
		},
		{
			name:      "file info app error",
			post:      &model.Post{Type: "", FileIds: model.StringArray{fileID}},
			appErr:    model.NewAppError("TestMessageWillBePostedSkipsNonVoicePosts", "test.app_error", nil, "", http.StatusInternalServerError),
			expectAPI: true,
		},
		{
			name:      "nil file info",
			post:      &model.Post{Type: "", FileIds: model.StringArray{fileID}},
			fileInfo:  nil,
			expectAPI: true,
		},
		{
			name:      "unsupported mime type",
			post:      &model.Post{Type: "", FileIds: model.StringArray{fileID}},
			fileInfo:  &model.FileInfo{Id: fileID, Name: "notes.txt", Size: 42, MimeType: "text/plain"},
			expectAPI: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			api := &plugintest.API{}
			p := &Plugin{}
			p.SetAPI(api)

			if tc.expectAPI {
				api.On("GetFileInfo", fileID).Return(tc.fileInfo, tc.appErr)
			}

			updated, rejection := p.MessageWillBePosted(nil, tc.post)

			assert.Nil(t, updated)
			assert.Empty(t, rejection)
			api.AssertExpectations(t)
		})
	}
}
