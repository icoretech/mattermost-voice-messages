package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const (
	defaultClientTranscriptionModel        = "whisper-tiny"
	defaultClientTranscriptionQuantization = "hybrid"
)

var allowedClientTranscriptionModels = map[string]struct{}{
	"whisper-tiny":                       {},
	"whisper-base":                       {},
	"whisper-small":                      {},
	"whisper-tiny_timestamped":           {},
	"whisper-base_timestamped":           {},
	"whisper-small_timestamped":          {},
	"whisper-large-v3-turbo":             {},
	"whisper-large-v3-turbo_timestamped": {},
	"whisper-large-v3":                   {},
	"lite-whisper-large-v3-turbo-fast":   {},
	"lite-whisper-large-v3-turbo":        {},
	"lite-whisper-large-v3-turbo-acc":    {},
	"moonshine-tiny":                     {},
	"moonshine-base":                     {},
	"distil-whisper-small":               {},
}

var allowedClientTranscriptionQuantizations = map[string]struct{}{
	"hybrid": {},
	"q4":     {},
	"q8":     {},
	"fp16":   {},
	"fp32":   {},
}

type configuration struct {
	EnableVoiceMessages             *bool  `json:"EnableVoiceMessages"`
	EnableUploadedAudioPreview      *bool  `json:"EnableUploadedAudioPreview"`
	EnableClientTranscription       *bool  `json:"EnableClientTranscription"`
	ClientTranscriptionAutoStart    *bool  `json:"ClientTranscriptionAutoStart"`
	ClientTranscriptionModel        string `json:"ClientTranscriptionModel"`
	ClientTranscriptionQuantization string `json:"ClientTranscriptionQuantization"`
	ClientTranscriptionLanguage     string `json:"ClientTranscriptionLanguage"`
}

type clientConfiguration struct {
	VoiceMessagesEnabled            bool   `json:"voice_messages_enabled"`
	UploadedAudioPreviewEnabled     bool   `json:"uploaded_audio_preview_enabled"`
	ClientTranscriptionEnabled      bool   `json:"client_transcription_enabled"`
	ClientTranscriptionAutoStart    bool   `json:"client_transcription_auto_start"`
	ClientTranscriptionModel        string `json:"client_transcription_model"`
	ClientTranscriptionQuantization string `json:"client_transcription_quantization"`
	ClientTranscriptionLanguage     string `json:"client_transcription_language"`
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func cloneBoolPointer(value *bool) *bool {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func (c *configuration) Clone() *configuration {
	if c == nil {
		return &configuration{}
	}

	return &configuration{
		EnableVoiceMessages:             cloneBoolPointer(c.EnableVoiceMessages),
		EnableUploadedAudioPreview:      cloneBoolPointer(c.EnableUploadedAudioPreview),
		EnableClientTranscription:       cloneBoolPointer(c.EnableClientTranscription),
		ClientTranscriptionAutoStart:    cloneBoolPointer(c.ClientTranscriptionAutoStart),
		ClientTranscriptionModel:        c.ClientTranscriptionModel,
		ClientTranscriptionQuantization: c.ClientTranscriptionQuantization,
		ClientTranscriptionLanguage:     c.ClientTranscriptionLanguage,
	}
}

func (c *configuration) voiceMessagesEnabled() bool {
	return boolValue(c.EnableVoiceMessages, true)
}

func (c *configuration) uploadedAudioPreviewEnabled() bool {
	return boolValue(c.EnableUploadedAudioPreview, true)
}

func (c *configuration) clientTranscriptionEnabled() bool {
	return boolValue(c.EnableClientTranscription, false)
}

func (c *configuration) clientTranscriptionAutoStart() bool {
	return boolValue(c.ClientTranscriptionAutoStart, false)
}

func (c *configuration) clientTranscriptionModel() string {
	model := strings.TrimSpace(c.ClientTranscriptionModel)
	if _, ok := allowedClientTranscriptionModels[model]; ok {
		return model
	}
	return defaultClientTranscriptionModel
}

func (c *configuration) clientTranscriptionQuantization() string {
	quantization := strings.TrimSpace(c.ClientTranscriptionQuantization)
	if _, ok := allowedClientTranscriptionQuantizations[quantization]; ok {
		return quantization
	}
	return defaultClientTranscriptionQuantization
}

func (c *configuration) clientTranscriptionLanguage() string {
	return strings.TrimSpace(c.ClientTranscriptionLanguage)
}

func (c *configuration) clientConfiguration() clientConfiguration {
	return clientConfiguration{
		VoiceMessagesEnabled:            c.voiceMessagesEnabled(),
		UploadedAudioPreviewEnabled:     c.uploadedAudioPreviewEnabled(),
		ClientTranscriptionEnabled:      c.clientTranscriptionEnabled(),
		ClientTranscriptionAutoStart:    c.clientTranscriptionAutoStart(),
		ClientTranscriptionModel:        c.clientTranscriptionModel(),
		ClientTranscriptionQuantization: c.clientTranscriptionQuantization(),
		ClientTranscriptionLanguage:     c.clientTranscriptionLanguage(),
	}
}

func (c *configuration) Validate() error {
	model := strings.TrimSpace(c.ClientTranscriptionModel)
	if model != "" {
		if _, ok := allowedClientTranscriptionModels[model]; !ok {
			return fmt.Errorf("invalid ClientTranscriptionModel")
		}
	}

	quantization := strings.TrimSpace(c.ClientTranscriptionQuantization)
	if quantization != "" {
		if _, ok := allowedClientTranscriptionQuantizations[quantization]; !ok {
			return fmt.Errorf("invalid ClientTranscriptionQuantization")
		}
	}

	language := strings.TrimSpace(c.ClientTranscriptionLanguage)
	if len(language) > 35 {
		return fmt.Errorf("invalid ClientTranscriptionLanguage")
	}
	for _, char := range language {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' {
			continue
		}
		return fmt.Errorf("invalid ClientTranscriptionLanguage")
	}

	return nil
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	return p.configuration.Clone()
}

func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	p.configuration = configuration.Clone()
}

func (p *Plugin) OnConfigurationChange() error {
	configuration := new(configuration)

	if err := p.API.LoadPluginConfiguration(configuration); err != nil {
		return fmt.Errorf("failed to load plugin configuration: %w", err)
	}

	if err := configuration.Validate(); err != nil {
		return fmt.Errorf("invalid plugin configuration: %w", err)
	}

	p.setConfiguration(configuration)
	return nil
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	config := p.getConfiguration().clientConfiguration()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(config); err != nil && p.API != nil {
		p.API.LogError("failed to encode plugin configuration response", "error", err.Error())
	}
}
