package main

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

type voiceAudioPart struct {
	data     []byte
	mimeType string
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
	declaredMimeType := ""
	if contentType != "" {
		var ok bool
		declaredMimeType, _, ok = detectVoiceAudio(contentType)
		if !ok {
			return voiceAudioPart{}, &handlerError{message: "Unsupported audio type", status: http.StatusUnsupportedMediaType}
		}
	}
	detectedMimeType, ok := detectVoiceAudioBytes(data)
	if !ok || (declaredMimeType != "" && !voiceAudioMimeTypesMatch(declaredMimeType, detectedMimeType)) {
		return voiceAudioPart{}, &handlerError{message: "Unsupported audio type", status: http.StatusUnsupportedMediaType}
	}
	mimeType := detectedMimeType
	if declaredMimeType != "" {
		mimeType = declaredMimeType
	}

	return voiceAudioPart{data: data, mimeType: mimeType}, nil
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

func detectVoiceAudioBytes(data []byte) (mimeType string, ok bool) {
	switch {
	case len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		return "audio/webm", true
	case len(data) >= 4 && bytes.Equal(data[:4], []byte("OggS")):
		return "audio/ogg", true
	case len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")):
		return "audio/mp4", true
	case len(data) >= 3 && bytes.Equal(data[:3], []byte("ID3")):
		return "audio/mpeg", true
	case len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0:
		return "audio/mpeg", true
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE")):
		return "audio/wav", true
	default:
		return "", false
	}
}

func voiceAudioMimeTypesMatch(declaredMimeType string, detectedMimeType string) bool {
	if declaredMimeType == detectedMimeType {
		return true
	}
	return detectedMimeType == "audio/wav" && declaredMimeType == "audio/x-wav"
}
