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

const voicePostType = "custom_ic_voice_msg"
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

	r.Body = http.MaxBytesReader(w, r.Body, maxVoiceMessageBytes+multipartOverheadBytes)
	req, handlerErr := parseVoiceMessageRequest(r, maxVoiceMessageBytes)
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

func parseVoiceMessageRequest(r *http.Request, maxBytes int64) (parsed voiceMessageRequest, handlerErr *handlerError) {
	if err := r.ParseMultipartForm(multipartOverheadBytes); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return voiceMessageRequest{}, &handlerError{message: "Voice message too large", status: http.StatusRequestEntityTooLarge}
		}
		return voiceMessageRequest{}, &handlerError{message: "Missing audio file", status: http.StatusBadRequest}
	}

	channelID := r.FormValue("channel_id")
	if !model.IsValidId(channelID) {
		return voiceMessageRequest{}, &handlerError{message: "Invalid channel_id", status: http.StatusBadRequest}
	}

	rootID := r.FormValue("root_id")
	if rootID != "" && !model.IsValidId(rootID) {
		return voiceMessageRequest{}, &handlerError{message: "Invalid root_id", status: http.StatusBadRequest}
	}

	durationMS := int64(0)
	if durationValue := r.FormValue("duration_ms"); durationValue != "" {
		parsed, err := strconv.ParseInt(durationValue, 10, 64)
		if err != nil || parsed < 0 || parsed > maxVoiceMessageDurationMS {
			return voiceMessageRequest{}, &handlerError{message: "Invalid duration_ms", status: http.StatusBadRequest}
		}
		durationMS = parsed
	}

	waveform, handlerErr := parseVoiceWaveform(r.FormValue("waveform"))
	if handlerErr != nil {
		return voiceMessageRequest{}, handlerErr
	}

	file, header, err := r.FormFile("audio")
	if err != nil {
		return voiceMessageRequest{}, &handlerError{message: "Missing audio file", status: http.StatusBadRequest}
	}
	defer func() {
		if err := file.Close(); err != nil && handlerErr == nil {
			handlerErr = &handlerError{message: "Could not read audio file", status: http.StatusBadRequest}
		}
	}()

	data, handlerErr := readVoiceAudioData(file, maxBytes)
	if handlerErr != nil {
		return voiceMessageRequest{}, handlerErr
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
		return voiceMessageRequest{}, &handlerError{message: "Unsupported audio type", status: http.StatusUnsupportedMediaType}
	}

	return voiceMessageRequest{
		channelID:  channelID,
		rootID:     rootID,
		durationMS: durationMS,
		mimeType:   mimeType,
		waveform:   waveform,
		data:       data,
	}, nil
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

func buildVoiceMessagePost(userID string, req voiceMessageRequest, fileInfo *model.FileInfo) *model.Post {
	filename := fileInfo.Name
	if filename == "" {
		filename = "voice-message" + extensionForMime(req.mimeType)
	}

	voiceMessage := map[string]any{
		"version":     1,
		"file_id":     fileInfo.Id,
		"filename":    filename,
		"mime_type":   req.mimeType,
		"duration_ms": req.durationMS,
		"size":        int64(len(req.data)),
	}
	if len(req.waveform) > 0 {
		voiceMessage["waveform"] = req.waveform
	}

	return &model.Post{
		UserId:    userID,
		ChannelId: req.channelID,
		RootId:    req.rootID,
		Message:   "Voice message",
		Type:      voicePostType,
		FileIds:   []string{fileInfo.Id},
		Props: model.StringInterface{
			"voice_message": voiceMessage,
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
