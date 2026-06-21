package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMattermostAuthRequiredRejectsMissingUserID(t *testing.T) {
	called := false
	handler := (&Plugin{}).mattermostAuthRequired(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "Not authorized\n", rec.Body.String())
	assert.False(t, called)
}

func TestMattermostAuthRequiredPassesAuthenticatedRequest(t *testing.T) {
	called := false
	handler := (&Plugin{}).mattermostAuthRequired(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, "user-id", r.Header.Get("Mattermost-User-ID"))
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", "user-id")

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.True(t, called)
}

func TestServeHTTPRoutesConfigBehindMattermostAuth(t *testing.T) {
	p := &Plugin{}
	p.setConfiguration(&configuration{
		EnableVoiceMessages:       new(false),
		EnableClientTranscription: new(true),
		ClientTranscriptionModel:  "whisper-base",
	})
	p.router = p.initRouter()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	req.Header.Set("Mattermost-User-ID", "user-id")

	p.ServeHTTP(nil, rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	var response clientConfiguration
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&response))
	assert.False(t, response.VoiceMessagesEnabled)
	assert.True(t, response.ClientTranscriptionEnabled)
	assert.Equal(t, "whisper-base", response.ClientTranscriptionModel)
}
