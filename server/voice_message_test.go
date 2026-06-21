package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type voiceMessageUploadContract struct {
	AudioField          string            `json:"audio_field"`
	FileName            string            `json:"file_name"`
	FileMimeType        string            `json:"file_mime_type"`
	TextFields          map[string]string `json:"text_fields"`
	ForbiddenTextFields []string          `json:"forbidden_text_fields"`
}

func loadVoiceMessageUploadContract(t *testing.T) voiceMessageUploadContract {
	t.Helper()

	data, err := os.ReadFile("../testdata/voice_message_upload_contract.json")
	require.NoError(t, err)

	var contract voiceMessageUploadContract
	require.NoError(t, json.Unmarshal(data, &contract))
	return contract
}

func TestDetectVoiceAudioAcceptsSupportedTypes(t *testing.T) {
	testCases := []struct {
		contentType string
		mimeType    string
		extension   string
	}{
		{contentType: "audio/webm", mimeType: "audio/webm", extension: ".webm"},
		{contentType: "audio/webm;codecs=opus", mimeType: "audio/webm", extension: ".webm"},
		{contentType: "audio/ogg", mimeType: "audio/ogg", extension: ".ogg"},
		{contentType: "audio/mp4", mimeType: "audio/mp4", extension: ".m4a"},
		{contentType: "audio/mpeg", mimeType: "audio/mpeg", extension: ".mp3"},
		{contentType: "audio/wav", mimeType: "audio/wav", extension: ".wav"},
		{contentType: "audio/x-wav", mimeType: "audio/x-wav", extension: ".wav"},
	}

	for _, tc := range testCases {
		t.Run(tc.contentType, func(t *testing.T) {
			mimeType, extension, ok := detectVoiceAudio(tc.contentType)

			require.True(t, ok)
			assert.Equal(t, tc.mimeType, mimeType)
			assert.Equal(t, tc.extension, extension)
		})
	}
}

func TestDetectVoiceAudioRejectsUnsupportedTypes(t *testing.T) {
	for _, contentType := range []string{"text/plain", "application/octet-stream", ""} {
		t.Run(contentType, func(t *testing.T) {
			mimeType, extension, ok := detectVoiceAudio(contentType)

			assert.False(t, ok)
			assert.Empty(t, mimeType)
			assert.Empty(t, extension)
		})
	}
}

func TestBuildVoiceMessagePost(t *testing.T) {
	userID := model.NewId()
	channelID := model.NewId()
	rootID := model.NewId()
	fileID := model.NewId()
	req := voiceMessageRequest{
		channelID:  channelID,
		rootID:     rootID,
		durationMS: 12_345,
		mimeType:   "audio/webm",
		waveform:   []any{0.25, 0.5},
		data:       []byte("voice data"),
		transcript: "hello transcript",
	}
	fileInfo := &model.FileInfo{Id: fileID, Name: "voice-message-1710000000000.webm"}

	post := buildVoiceMessagePost(userID, req, fileInfo)

	assert.Equal(t, userID, post.UserId)
	assert.Equal(t, channelID, post.ChannelId)
	assert.Equal(t, rootID, post.RootId)
	assert.Empty(t, post.Type)
	assert.Equal(t, "hello transcript", post.Message)
	assert.Equal(t, model.StringArray{fileID}, post.FileIds)
	assert.Len(t, post.Props, 1)
	voiceMessage, ok := post.Props["voice_message"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 1, voiceMessage["version"])
	assert.Equal(t, fileID, voiceMessage["file_id"])
	assert.Equal(t, "voice-message-1710000000000.webm", voiceMessage["filename"])
	assert.Equal(t, "audio/webm", voiceMessage["mime_type"])
	assert.Equal(t, int64(12_345), voiceMessage["duration_ms"])
	assert.Equal(t, int64(len(req.data)), voiceMessage["size"])
	assert.Equal(t, []any{0.25, 0.5}, voiceMessage["waveform"])

	req.transcript = ""
	post = buildVoiceMessagePost(userID, req, fileInfo)
	assert.Empty(t, post.Message)
}

func TestBuildVoiceMessagePropsUsesFallbackFilenameAndOmitsEmptyWaveform(t *testing.T) {
	fileID := model.NewId()
	fileInfo := &model.FileInfo{Id: fileID}

	voiceMessage := buildVoiceMessageProps(fileInfo, "audio/wav", 123, 456, nil)

	assert.Equal(t, 1, voiceMessage["version"])
	assert.Equal(t, fileID, voiceMessage["file_id"])
	assert.Equal(t, "voice-message.wav", voiceMessage["filename"])
	assert.Equal(t, "audio/wav", voiceMessage["mime_type"])
	assert.Equal(t, int64(123), voiceMessage["duration_ms"])
	assert.Equal(t, int64(456), voiceMessage["size"])
	assert.NotContains(t, voiceMessage, "waveform")
}

func TestParseVoiceMessageRequestRejectsInvalidMultipart(t *testing.T) {
	validChannelID := model.NewId()
	validRootID := model.NewId()
	testCases := []struct {
		name       string
		fields     map[string]string
		file       []byte
		fileName   string
		maxBytes   int64
		wantStatus int
		wantBody   string
	}{
		{
			name:       "missing audio",
			fields:     map[string]string{"channel_id": validChannelID},
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Missing audio file",
		},
		{
			name:       "missing channel id",
			file:       validWebMAudioBytes(),
			fileName:   "voice.webm",
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Invalid channel_id",
		},
		{
			name:       "invalid channel id",
			fields:     map[string]string{"channel_id": "not-valid"},
			file:       validWebMAudioBytes(),
			fileName:   "voice.webm",
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Invalid channel_id",
		},
		{
			name:       "invalid root id",
			fields:     map[string]string{"channel_id": validChannelID, "root_id": "not-valid"},
			file:       validWebMAudioBytes(),
			fileName:   "voice.webm",
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Invalid root_id",
		},
		{
			name:       "negative duration",
			fields:     map[string]string{"channel_id": validChannelID, "root_id": validRootID, "duration_ms": "-1"},
			file:       validWebMAudioBytes(),
			fileName:   "voice.webm",
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Invalid duration_ms",
		},
		{
			name:       "empty file",
			fields:     map[string]string{"channel_id": validChannelID},
			file:       []byte{},
			fileName:   "voice.webm",
			maxBytes:   maxVoiceMessageBytes,
			wantStatus: http.StatusBadRequest,
			wantBody:   "Empty audio file",
		},
		{
			name:       "over cap file",
			fields:     map[string]string{"channel_id": validChannelID},
			file:       validWebMAudioBytes(),
			fileName:   "voice.webm",
			maxBytes:   3,
			wantStatus: http.StatusRequestEntityTooLarge,
			wantBody:   "Voice message too large",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := newVoiceMultipartRequest(t, tc.fields, tc.fileName, "audio/webm", tc.file)

			_, handlerErr := parseVoiceMessageRequest(req, tc.maxBytes, false)

			require.NotNil(t, handlerErr)
			assert.Equal(t, tc.wantStatus, handlerErr.status)
			assert.Equal(t, tc.wantBody, handlerErr.message)
		})
	}
}

func TestParseVoiceMessageRequestRejectsMalformedMultipart(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/voice-messages", strings.NewReader("not multipart"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=missing")

	_, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

	require.NotNil(t, handlerErr)
	assert.Equal(t, http.StatusBadRequest, handlerErr.status)
	assert.Equal(t, "Invalid multipart form", handlerErr.message)
}

func TestParseVoiceMessageRequestAcceptsClientUploadContract(t *testing.T) {
	contract := loadVoiceMessageUploadContract(t)
	for _, field := range contract.ForbiddenTextFields {
		assert.NotContains(t, contract.TextFields, field)
	}

	req := newVoiceMultipartRequestWithAudioField(
		t,
		contract.TextFields,
		contract.AudioField,
		contract.FileName,
		contract.FileMimeType,
		validWebMAudioBytes(),
	)

	parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, true)

	require.Nil(t, handlerErr)
	assert.Equal(t, contract.TextFields["channel_id"], parsed.channelID)
	assert.Equal(t, contract.TextFields["root_id"], parsed.rootID)
	assert.Equal(t, int64(1234), parsed.durationMS)
	assert.Equal(t, contract.FileMimeType, parsed.mimeType)
	assert.Equal(t, contract.TextFields["transcript"], parsed.transcript)
	assert.Equal(t, validWebMAudioBytes(), parsed.data)
	assert.Len(t, parsed.waveform, voiceWaveformBarCount)
}

func TestParseVoiceMessageRequestReturnsValidatedAudio(t *testing.T) {
	channelID := model.NewId()
	rootID := model.NewId()
	peaks := make([]float64, voiceWaveformBarCount)
	for index := range peaks {
		peaks[index] = float64(index) / float64(voiceWaveformBarCount)
	}
	waveformJSON, err := json.Marshal(peaks)
	require.NoError(t, err)
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id":  channelID,
		"root_id":     rootID,
		"duration_ms": "1234",
		"waveform":    string(waveformJSON),
	}, "ignored-name.webm", "audio/webm;codecs=opus", validWebMAudioBytes())

	parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

	require.Nil(t, handlerErr)
	assert.Equal(t, channelID, parsed.channelID)
	assert.Equal(t, rootID, parsed.rootID)
	assert.Equal(t, int64(1234), parsed.durationMS)
	assert.Equal(t, "audio/webm", parsed.mimeType)
	assert.Equal(t, validWebMAudioBytes(), parsed.data)
	assert.Equal(t, peaks[1], parsed.waveform[1])
}

func TestParseVoiceMessageRequestIgnoresTranscriptWhenDisabled(t *testing.T) {
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id": model.NewId(),
		"transcript": "hello",
	}, "voice.webm", "audio/webm", validWebMAudioBytes())

	parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, false)

	require.Nil(t, handlerErr)
	assert.Empty(t, parsed.transcript)
}

func TestParseVoiceMessageRequestNormalizesTranscriptWhenEnabled(t *testing.T) {
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id": model.NewId(),
		"transcript": "  hello\r\nworld\r  ",
	}, "voice.webm", "audio/webm", validWebMAudioBytes())

	parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, true)

	require.Nil(t, handlerErr)
	assert.Equal(t, "hello\nworld", parsed.transcript)
}

func TestParseVoiceMessageRequestTruncatesOverlongTranscript(t *testing.T) {
	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id": model.NewId(),
		"transcript": strings.Repeat("a", model.PostMessageMaxRunesV2+5),
	}, "voice.webm", "audio/webm", validWebMAudioBytes())

	parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, true)

	require.Nil(t, handlerErr)
	assert.Len(t, []rune(parsed.transcript), model.PostMessageMaxRunesV2)
	assert.True(t, strings.HasSuffix(parsed.transcript, "…"))
}

func TestHandleGetConfigRejectsMissingUser(t *testing.T) {
	p := &Plugin{router: (&Plugin{}).initRouter()}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not authorized")
}

func TestHandleGetConfigReturnsEffectiveDefaults(t *testing.T) {
	p := &Plugin{router: (&Plugin{}).initRouter()}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", model.NewId())
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	var response clientConfiguration
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&response))
	assert.Equal(t, defaultClientConfiguration(), response)
}

func TestHandleCreateVoiceMessageRejectsMissingUser(t *testing.T) {
	p := &Plugin{router: (&Plugin{}).initRouter()}
	req := newVoiceMultipartRequest(t, map[string]string{"channel_id": model.NewId()}, "voice.webm", "audio/webm", validWebMAudioBytes())
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Not authorized")
}

func TestHandleCreateVoiceMessageRejectsDisabledVoiceMessages(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{EnableVoiceMessages: new(false)})
	p.router = p.initRouter()
	req := newVoiceMultipartRequest(t, map[string]string{"channel_id": model.NewId()}, "voice.webm", "audio/webm", validWebMAudioBytes())
	req.Header.Set("Mattermost-User-ID", model.NewId())
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "Voice messages are disabled")
	api.AssertExpectations(t)
}
func TestHandleCreateVoiceMessageUploadsFileAndCreatesPost(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.router = p.initRouter()
	userID := model.NewId()
	channelID := model.NewId()
	rootID := model.NewId()
	audio := validWebMAudioBytes()
	fileInfo := &model.FileInfo{Id: model.NewId(), Name: "voice-message-1710000000000.webm", Size: int64(len(audio)), MimeType: "audio/webm"}
	createdPost := &model.Post{Id: model.NewId(), UserId: userID, ChannelId: channelID, RootId: rootID, FileIds: []string{fileInfo.Id}}

	api.On("GetChannelMember", channelID, userID).Return(&model.ChannelMember{}, (*model.AppError)(nil))
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionCreatePost).Return(true)
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionUploadFile).Return(true)
	api.On("GetPost", rootID).Return(&model.Post{Id: rootID, ChannelId: channelID}, (*model.AppError)(nil))
	api.On(
		"UploadFile",
		mock.MatchedBy(func(data []byte) bool { return bytes.Equal(data, audio) }),
		channelID,
		mock.MatchedBy(func(filename string) bool {
			return strings.HasPrefix(filename, "voice-message-") && strings.HasSuffix(filename, ".webm") && model.IsValidFilename(filename)
		}),
	).Return(fileInfo, (*model.AppError)(nil))
	api.On("CreatePost", mock.MatchedBy(func(post *model.Post) bool {
		voiceMessage, ok := post.Props["voice_message"].(map[string]any)
		return ok &&
			voiceMessage["waveform"] != nil &&
			post.UserId == userID &&
			post.ChannelId == channelID &&
			post.RootId == rootID &&
			post.Type == "" &&
			post.Message == "" &&
			len(post.FileIds) == 1 &&
			post.FileIds[0] == fileInfo.Id
	})).Return(createdPost, (*model.AppError)(nil))

	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id":  channelID,
		"root_id":     rootID,
		"duration_ms": "1234",
		"waveform":    `[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1,0.2,0.3,0.4,0.5,0.6]`,
	}, "voice.webm", "audio/webm", audio)
	req.Header.Set("Mattermost-User-ID", userID)
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	assert.Contains(t, rec.Body.String(), createdPost.Id)
	assert.Contains(t, rec.Body.String(), fileInfo.Id)
	api.AssertExpectations(t)
}

func TestHandleCreateVoiceMessageStoresTranscriptWhenEnabled(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{EnableClientTranscription: new(true)})
	p.router = p.initRouter()
	userID := model.NewId()
	channelID := model.NewId()
	fileInfo := &model.FileInfo{Id: model.NewId(), Name: "voice-message.webm", Size: 3, MimeType: "audio/webm"}
	createdPost := &model.Post{Id: model.NewId(), UserId: userID, ChannelId: channelID, FileIds: []string{fileInfo.Id}, Message: "hello"}

	api.On("GetChannelMember", channelID, userID).Return(&model.ChannelMember{}, (*model.AppError)(nil))
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionCreatePost).Return(true)
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionUploadFile).Return(true)
	api.On("UploadFile", mock.Anything, channelID, mock.Anything).Return(fileInfo, (*model.AppError)(nil))
	api.On("CreatePost", mock.MatchedBy(func(post *model.Post) bool {
		return post.Message == "hello"
	})).Return(createdPost, (*model.AppError)(nil))

	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id":  channelID,
		"duration_ms": "1234",
		"transcript":  "hello",
	}, "voice.webm", "audio/webm", validWebMAudioBytes())
	req.Header.Set("Mattermost-User-ID", userID)
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	api.AssertExpectations(t)
}

func TestHandleCreateVoiceMessageIgnoresTranscriptWhenDisabled(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{EnableClientTranscription: new(false)})
	p.router = p.initRouter()
	userID := model.NewId()
	channelID := model.NewId()
	fileInfo := &model.FileInfo{Id: model.NewId(), Name: "voice-message.webm", Size: 3, MimeType: "audio/webm"}
	createdPost := &model.Post{Id: model.NewId(), UserId: userID, ChannelId: channelID, FileIds: []string{fileInfo.Id}}

	api.On("GetChannelMember", channelID, userID).Return(&model.ChannelMember{}, (*model.AppError)(nil))
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionCreatePost).Return(true)
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionUploadFile).Return(true)
	api.On("UploadFile", mock.Anything, channelID, mock.Anything).Return(fileInfo, (*model.AppError)(nil))
	api.On("CreatePost", mock.MatchedBy(func(post *model.Post) bool {
		return post.Message == ""
	})).Return(createdPost, (*model.AppError)(nil))

	req := newVoiceMultipartRequest(t, map[string]string{
		"channel_id":  channelID,
		"duration_ms": "1234",
		"transcript":  "hello",
	}, "voice.webm", "audio/webm", validWebMAudioBytes())
	req.Header.Set("Mattermost-User-ID", userID)
	rec := httptest.NewRecorder()

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	api.AssertExpectations(t)
}

func newVoiceMultipartRequest(t *testing.T, fields map[string]string, fileName string, contentType string, file []byte) *http.Request {
	t.Helper()

	return newVoiceMultipartRequestWithAudioField(t, fields, "audio", fileName, contentType, file)
}

func newVoiceMultipartRequestWithAudioField(t *testing.T, fields map[string]string, audioField string, fileName string, contentType string, file []byte) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		require.NoError(t, writer.WriteField(name, value))
	}
	if fileName != "" {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, audioField, fileName))
		if contentType != "" {
			header.Set("Content-Type", contentType)
		}
		part, err := writer.CreatePart(header)
		require.NoError(t, err)
		_, err = part.Write(file)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/voice-messages", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}
