package main

import (
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

const maxVoiceMessageBytes = 25 * 1024 * 1024
const multipartOverheadBytes = 1 * 1024 * 1024
const maxVoiceMessageDurationMS = 6 * 60 * 60 * 1000
const voiceWaveformBarCount = 24

type voiceMessageRequest struct {
	channelID  string
	rootID     string
	durationMS int64
	mimeType   string
	waveform   []any
	data       []byte
	transcript string
}

type voiceMessageFormFields struct {
	channelID  string
	rootID     string
	durationMS int64
	waveform   []any
	transcript string
}

type voiceAudioPart struct {
	data     []byte
	mimeType string
}

type voiceMessageResponse struct {
	Post     *model.Post     `json:"post"`
	FileInfo *model.FileInfo `json:"file_info"`
}

type handlerError struct {
	message string
	status  int
}

func (p *Plugin) handleCreateVoiceMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	if userID == "" {
		http.Error(w, "Not authorized", http.StatusUnauthorized)
		return
	}

	configuration := p.getConfiguration()
	if !configuration.voiceMessagesEnabled() {
		http.Error(w, "Voice messages are disabled", http.StatusForbidden)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxVoiceMessageBytes+multipartOverheadBytes)
	req, handlerErr := parseVoiceMessageRequest(r, maxVoiceMessageBytes, configuration.clientTranscriptionEnabled())
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	if _, appErr := p.API.GetChannelMember(req.channelID, userID); appErr != nil {
		http.Error(w, "Not a channel member", http.StatusForbidden)
		return
	}

	if !p.API.HasPermissionToChannel(userID, req.channelID, model.PermissionCreatePost) {
		http.Error(w, "Missing create post permission", http.StatusForbidden)
		return
	}

	if !p.API.HasPermissionToChannel(userID, req.channelID, model.PermissionUploadFile) {
		http.Error(w, "Missing upload file permission", http.StatusForbidden)
		return
	}

	if req.rootID != "" {
		rootPost, appErr := p.API.GetPost(req.rootID)
		if appErr != nil || rootPost == nil || rootPost.ChannelId != req.channelID {
			http.Error(w, "Invalid root post", http.StatusBadRequest)
			return
		}
	}

	filename := model.SanitizeFilename("voice-message-" + strconv.FormatInt(time.Now().UnixMilli(), 10) + extensionForMime(req.mimeType))
	if !model.IsValidFilename(filename) {
		http.Error(w, "Invalid generated filename", http.StatusInternalServerError)
		return
	}

	fileInfo, appErr := p.API.UploadFile(req.data, req.channelID, filename)
	if appErr != nil {
		writeAppError(w, appErr, "Could not upload voice message")
		return
	}

	post := buildVoiceMessagePost(userID, req, fileInfo)
	createdPost, appErr := p.API.CreatePost(post)
	if appErr != nil {
		p.API.LogWarn("voice message file uploaded but post creation failed", "file_id", fileInfo.Id, "channel_id", req.channelID)
		writeAppError(w, appErr, "Could not create voice message post")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(voiceMessageResponse{Post: createdPost, FileInfo: fileInfo}); err != nil {
		p.API.LogError("failed to encode voice message response", "error", err.Error())
	}
}

func parseVoiceMessageRequest(r *http.Request, maxBytes int64, allowTranscript bool) (parsed voiceMessageRequest, handlerErr *handlerError) {
	if err := r.ParseMultipartForm(multipartOverheadBytes); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return voiceMessageRequest{}, &handlerError{message: "Voice message too large", status: http.StatusRequestEntityTooLarge}
		}
		return voiceMessageRequest{}, &handlerError{message: "Invalid multipart form", status: http.StatusBadRequest}
	}

	fields, handlerErr := parseVoiceMessageFormFields(r, allowTranscript)
	if handlerErr != nil {
		return voiceMessageRequest{}, handlerErr
	}

	audio, handlerErr := parseVoiceAudioPart(r, maxBytes)
	if handlerErr != nil {
		return voiceMessageRequest{}, handlerErr
	}

	return voiceMessageRequest{
		channelID:  fields.channelID,
		rootID:     fields.rootID,
		durationMS: fields.durationMS,
		mimeType:   audio.mimeType,
		waveform:   fields.waveform,
		data:       audio.data,
		transcript: fields.transcript,
	}, nil
}

func parseVoiceMessageFormFields(r *http.Request, allowTranscript bool) (voiceMessageFormFields, *handlerError) {
	channelID := r.FormValue("channel_id")
	if !model.IsValidId(channelID) {
		return voiceMessageFormFields{}, &handlerError{message: "Invalid channel_id", status: http.StatusBadRequest}
	}

	rootID := r.FormValue("root_id")
	if rootID != "" && !model.IsValidId(rootID) {
		return voiceMessageFormFields{}, &handlerError{message: "Invalid root_id", status: http.StatusBadRequest}
	}

	durationMS := int64(0)
	if durationValue := r.FormValue("duration_ms"); durationValue != "" {
		parsed, err := strconv.ParseInt(durationValue, 10, 64)
		if err != nil || parsed < 0 || parsed > maxVoiceMessageDurationMS {
			return voiceMessageFormFields{}, &handlerError{message: "Invalid duration_ms", status: http.StatusBadRequest}
		}
		durationMS = parsed
	}

	waveform, handlerErr := parseVoiceWaveform(r.FormValue("waveform"))
	if handlerErr != nil {
		return voiceMessageFormFields{}, handlerErr
	}

	transcript := ""
	if allowTranscript {
		transcript = normalizeVoiceTranscript(r.FormValue("transcript"))
	}

	return voiceMessageFormFields{channelID: channelID, rootID: rootID, durationMS: durationMS, waveform: waveform, transcript: transcript}, nil
}

func parseVoiceAudioPart(r *http.Request, maxBytes int64) (parsed voiceAudioPart, handlerErr *handlerError) {
	file, header, err := r.FormFile("audio")
	if err != nil {
		return voiceAudioPart{}, &handlerError{message: "Missing audio file", status: http.StatusBadRequest}
	}
	defer func() {
		if err := file.Close(); err != nil && handlerErr == nil {
			handlerErr = &handlerError{message: "Could not read audio file", status: http.StatusBadRequest}
		}
	}()

	data, handlerErr := readVoiceAudioData(file, maxBytes)
	if handlerErr != nil {
		return voiceAudioPart{}, handlerErr
	}

	contentType := ""
	if header != nil {
		contentType = header.Header.Get("Content-Type")
	}
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	mimeType, _, ok := detectVoiceAudio(contentType)
	if !ok {
		return voiceAudioPart{}, &handlerError{message: "Unsupported audio type", status: http.StatusUnsupportedMediaType}
	}

	return voiceAudioPart{data: data, mimeType: mimeType}, nil
}

func normalizeVoiceTranscript(value string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n"))
	if normalized == "" {
		return ""
	}

	limit := model.PostMessageMaxRunesV2 - 1
	runeCount := 0
	cutoff := len(normalized)
	for index := range normalized {
		if runeCount == limit {
			cutoff = index
		}
		runeCount++
		if runeCount > model.PostMessageMaxRunesV2 {
			return normalized[:cutoff] + "…"
		}
	}

	return normalized
}

func parseVoiceWaveform(value string) ([]any, *handlerError) {
	if value == "" {
		return nil, nil
	}

	var peaks []float64
	if err := json.Unmarshal([]byte(value), &peaks); err != nil {
		return nil, &handlerError{message: "Invalid waveform", status: http.StatusBadRequest}
	}
	if len(peaks) != voiceWaveformBarCount {
		return nil, &handlerError{message: "Invalid waveform", status: http.StatusBadRequest}
	}

	waveform := make([]any, len(peaks))
	for index, peak := range peaks {
		if peak < 0 || peak > 1 {
			return nil, &handlerError{message: "Invalid waveform", status: http.StatusBadRequest}
		}
		waveform[index] = peak
	}

	return waveform, nil
}

func readVoiceAudioData(file multipart.File, maxBytes int64) ([]byte, *handlerError) {
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, &handlerError{message: "Could not read audio file", status: http.StatusBadRequest}
	}
	if len(data) == 0 {
		return nil, &handlerError{message: "Empty audio file", status: http.StatusBadRequest}
	}
	if int64(len(data)) > maxBytes {
		return nil, &handlerError{message: "Voice message too large", status: http.StatusRequestEntityTooLarge}
	}
	return data, nil
}

func detectVoiceAudio(contentType string) (mimeType string, extension string, ok bool) {
	mimeType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch mimeType {
	case "audio/webm":
		return mimeType, ".webm", true
	case "audio/ogg":
		return mimeType, ".ogg", true
	case "audio/mp4":
		return mimeType, ".m4a", true
	case "audio/mpeg":
		return mimeType, ".mp3", true
	case "audio/wav", "audio/x-wav":
		return mimeType, ".wav", true
	default:
		return "", "", false
	}
}

func buildVoiceMessageProps(fileInfo *model.FileInfo, mimeType string, durationMS int64, size int64, waveform []any) map[string]any {
	filename := fileInfo.Name
	if filename == "" {
		filename = "voice-message" + extensionForMime(mimeType)
	}

	voiceMessage := map[string]any{
		"version":     1,
		"file_id":     fileInfo.Id,
		"filename":    filename,
		"mime_type":   mimeType,
		"duration_ms": durationMS,
		"size":        size,
	}
	if len(waveform) > 0 {
		voiceMessage["waveform"] = waveform
	}

	return voiceMessage
}

func buildVoiceMessagePost(userID string, req voiceMessageRequest, fileInfo *model.FileInfo) *model.Post {
	return &model.Post{
		UserId:    userID,
		ChannelId: req.channelID,
		RootId:    req.rootID,
		Message:   req.transcript,
		FileIds:   []string{fileInfo.Id},
		Props: model.StringInterface{
			"voice_message": buildVoiceMessageProps(fileInfo, req.mimeType, req.durationMS, int64(len(req.data)), req.waveform),
		},
	}
}

func extensionForMime(mimeType string) string {
	_, extension, ok := detectVoiceAudio(mimeType)
	if !ok {
		return ""
	}
	return extension
}

func writeAppError(w http.ResponseWriter, appErr *model.AppError, fallback string) {
	status := appErr.StatusCode
	if status == 0 {
		status = http.StatusInternalServerError
	}
	message := appErr.Message
	if message == "" {
		message = fallback
	}
	http.Error(w, message, status)
}
