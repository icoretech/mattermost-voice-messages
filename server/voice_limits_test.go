package main

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func testServerConfig(maxBytes int64) *model.Config {
	return &model.Config{FileSettings: model.FileSettings{MaxFileSize: new(maxBytes)}}
}

func TestVoiceLimitsResolveConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name                                 string
		size, duration                       *int64
		serverBytes, wantBytes, wantDuration int64
	}{
		{"defaults", nil, nil, 100 * bytesPerMiB, 25 * bytesPerMiB, 21600000},
		{"inherit and unlimited duration", new(int64(0)), new(int64(0)), 70 * bytesPerMiB, 70 * bytesPerMiB, 0},
		{"larger plugin cap", new(int64(80)), new(int64(30000)), 100 * bytesPerMiB, 80 * bytesPerMiB, 30000000},
		{"smaller plugin cap", new(int64(2)), new(int64(10)), 100 * bytesPerMiB, 2 * bytesPerMiB, 10000},
		{"server cap wins", new(int64(80)), nil, 8 * bytesPerMiB, 8 * bytesPerMiB, 21600000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Given
			api := &plugintest.API{}
			api.On("GetConfig").Return(testServerConfig(tc.serverBytes)).Once()
			p := &Plugin{}
			p.SetAPI(api)
			// When
			limits, err := p.voiceLimits(&configuration{MaxVoiceMessageSizeMB: tc.size, MaxRecordingDurationSeconds: tc.duration})
			// Then
			require.NoError(t, err)
			assert.Equal(t, tc.wantBytes, limits.maxBytes)
			assert.Equal(t, tc.wantDuration, limits.maxDurationMS)
			api.AssertExpectations(t)
		})
	}
}

func TestVoiceLimitsRejectInvalidSettings(t *testing.T) {
	for _, tc := range []configuration{
		{MaxVoiceMessageSizeMB: new(int64(-1))}, {MaxRecordingDurationSeconds: new(int64(-1))},
		{MaxVoiceMessageSizeMB: new(maxSafeJSONInteger/bytesPerMiB + 1)}, {MaxRecordingDurationSeconds: new(maxSafeJSONInteger/1000 + 1)},
		{MaxVoiceMessageSizeMB: new(int64(math.MaxInt64))}, {MaxRecordingDurationSeconds: new(int64(math.MaxInt64))},
	} {
		require.Error(t, tc.Validate())
	}
	for _, raw := range []string{`{"MaxVoiceMessageSizeMB":1.5}`, `{"MaxRecordingDurationSeconds":0.5}`, `{"MaxVoiceMessageSizeMB":9223372036854775808}`} {
		var configuration configuration
		require.Error(t, json.Unmarshal([]byte(raw), &configuration))
	}
}

func TestVoiceLimitsCloneDoesNotSharePointers(t *testing.T) {
	original := &configuration{MaxVoiceMessageSizeMB: new(int64(0)), MaxRecordingDurationSeconds: new(int64(4))}
	cloned := original.Clone()
	*cloned.MaxVoiceMessageSizeMB = 10
	*cloned.MaxRecordingDurationSeconds = 15
	assert.Equal(t, int64(0), *original.MaxVoiceMessageSizeMB)
	assert.Equal(t, int64(4), *original.MaxRecordingDurationSeconds)
}

func TestVoiceLimitsUnavailableFailsClosed(t *testing.T) {
	for _, serverConfig := range []*model.Config{nil, {}, testServerConfig(0), testServerConfig(-1), testServerConfig(maxSafeJSONInteger + 1)} {
		api := &plugintest.API{}
		api.On("GetConfig").Return(serverConfig)
		p := &Plugin{}
		p.SetAPI(api)
		p.router = p.initRouter()
		for _, endpoint := range []string{"config", "voice-messages"} {
			var req *http.Request
			if endpoint == "config" {
				req = httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
			} else {
				req = newVoiceMultipartRequest(t, map[string]string{"channel_id": model.NewId(), "duration_ms": "1"}, "voice.webm", "audio/webm", validWebMAudioBytes())
			}
			req.Header.Set("Mattermost-User-ID", model.NewId())
			rec := httptest.NewRecorder()
			p.ServeHTTP(nil, rec, req)
			assert.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
		}
		api.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything)
	}
}

func TestGetConfigReadsChangedServerAndPluginLimits(t *testing.T) {
	api := &plugintest.API{}
	api.On("GetConfig").Return(testServerConfig(8 * bytesPerMiB)).Once()
	api.On("GetConfig").Return(testServerConfig(3 * bytesPerMiB)).Twice()
	p := &Plugin{}
	p.SetAPI(api)
	for index, want := range []int64{8 * bytesPerMiB, 3 * bytesPerMiB, 2 * bytesPerMiB} {
		if index == 2 {
			p.setConfiguration(&configuration{MaxVoiceMessageSizeMB: new(int64(2)), MaxRecordingDurationSeconds: new(int64(9))})
		}
		rec := httptest.NewRecorder()
		p.handleGetConfig(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
		require.Equal(t, http.StatusOK, rec.Code)
		var config clientConfiguration
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &config))
		assert.Equal(t, want, config.MaxVoiceMessageBytes)
		if index == 2 {
			assert.Equal(t, int64(9000), config.MaxRecordingDurationMS)
		}
	}
	api.AssertExpectations(t)
}

func TestVoiceUploadChunkedRejectsOversizedBytesBeforeUpload(t *testing.T) {
	for _, tc := range []struct {
		name string
		size int
	}{{"actual audio exceeds server cap", 1025}, {"request exceeds bounded multipart overhead", 1024 + multipartOverheadBytes + 1}} {
		t.Run(tc.name, func(t *testing.T) {
			// Given a real HTTP server and chunked multipart request, without Content-Length.
			api := &plugintest.API{}
			api.On("GetConfig").Return(testServerConfig(1024)).Once()
			p := &Plugin{}
			p.SetAPI(api)
			p.router = p.initRouter()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, int64(-1), r.ContentLength)
				assert.Contains(t, r.TransferEncoding, "chunked")
				p.ServeHTTP(nil, w, r)
			}))
			defer server.Close()
			audio := make([]byte, tc.size)
			copy(audio, validWebMAudioBytes())
			multipartRequest := newVoiceMultipartRequest(t, map[string]string{"channel_id": model.NewId(), "duration_ms": "1"}, "voice.webm", "audio/webm", audio)
			req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, server.URL+"/api/v1/voice-messages", multipartRequest.Body)
			require.NoError(t, err)
			req.Header = multipartRequest.Header.Clone()
			req.Header.Set("Mattermost-User-ID", model.NewId())
			req.ContentLength = -1
			// When
			response, err := server.Client().Do(req)
			require.NoError(t, err)
			defer func() { require.NoError(t, response.Body.Close()) }()
			body, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			// Then
			assert.Equal(t, http.StatusRequestEntityTooLarge, response.StatusCode, string(body))
			api.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything)
			api.AssertExpectations(t)
		})
	}
}

func TestVoiceUploadDurationLimit(t *testing.T) {
	for _, tc := range []struct {
		name, duration string
		capSeconds     int64
		accepted       bool
	}{
		{"boundary", "2000", 2, true}, {"over boundary", "2001", 2, false}, {"missing", "", 2, false}, {"zero", "0", 2, false},
		{"disabled accepts long recording", "21600001", 0, true}, {"disabled accepts missing", "", 0, true}, {"negative", "-1", 0, false}, {"unsafe JSON integer", "9007199254740992", 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := &plugintest.API{}
			api.On("GetConfig").Return(testServerConfig(100 * bytesPerMiB)).Once()
			p := &Plugin{}
			p.SetAPI(api)
			p.setConfiguration(&configuration{MaxRecordingDurationSeconds: new(tc.capSeconds)})
			p.router = p.initRouter()
			channelID, userID := model.NewId(), model.NewId()
			if tc.accepted {
				api.On("GetChannelMember", channelID, userID).Return(&model.ChannelMember{}, (*model.AppError)(nil))
				api.On("HasPermissionToChannel", userID, channelID, mock.Anything).Return(true)
				api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID}, (*model.AppError)(nil))
				api.On("UploadFile", mock.Anything, channelID, mock.Anything).Return(&model.FileInfo{Id: model.NewId()}, (*model.AppError)(nil)).Once()
				api.On("CreatePost", mock.Anything).Return(&model.Post{Id: model.NewId()}, (*model.AppError)(nil)).Once()
			}
			req := newVoiceMultipartRequest(t, map[string]string{"channel_id": channelID, "duration_ms": tc.duration}, "voice.webm", "audio/webm", validWebMAudioBytes())
			req.Header.Set("Mattermost-User-ID", userID)
			rec := httptest.NewRecorder()
			p.ServeHTTP(nil, rec, req)
			if tc.accepted {
				assert.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			} else {
				assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
				api.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything)
			}
			api.AssertExpectations(t)
		})
	}
}

func TestVoiceUploadUsesLiveServerLimit(t *testing.T) {
	// Given an inherited server limit that shrinks after the first upload.
	api := &plugintest.API{}
	audio := validWebMAudioBytes()
	api.On("GetConfig").Return(testServerConfig(int64(len(audio)))).Once()
	api.On("GetConfig").Return(testServerConfig(int64(len(audio) - 1))).Once()
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{MaxVoiceMessageSizeMB: new(int64(0))})
	p.router = p.initRouter()
	channelID, userID := model.NewId(), model.NewId()
	api.On("GetChannelMember", channelID, userID).Return(&model.ChannelMember{}, (*model.AppError)(nil)).Once()
	api.On("HasPermissionToChannel", userID, channelID, mock.Anything).Return(true).Twice()
	api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID}, (*model.AppError)(nil)).Once()
	api.On("UploadFile", audio, channelID, mock.Anything).Return(&model.FileInfo{Id: model.NewId()}, (*model.AppError)(nil)).Once()
	api.On("CreatePost", mock.Anything).Return(&model.Post{Id: model.NewId()}, (*model.AppError)(nil)).Once()
	// When the same audio is uploaded at the exact boundary, then after the limit shrinks.
	for _, want := range []int{http.StatusCreated, http.StatusRequestEntityTooLarge} {
		req := newVoiceMultipartRequest(t, map[string]string{"channel_id": channelID, "duration_ms": "1"}, "voice.webm", "audio/webm", audio)
		req.Header.Set("Mattermost-User-ID", userID)
		rec := httptest.NewRecorder()
		p.ServeHTTP(nil, rec, req)
		// Then only the first upload is accepted.
		assert.Equal(t, want, rec.Code, rec.Body.String())
	}
	api.AssertNumberOfCalls(t, "UploadFile", 1)
	api.AssertExpectations(t)
}
