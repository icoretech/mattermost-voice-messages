package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func defaultClientConfiguration() clientConfiguration {
	return clientConfiguration{
		MaxVoiceMessageBytes:            25 * 1024 * 1024,
		MaxRecordingDurationMS:          21600000,
		VoiceMessagesEnabled:            true,
		UploadedAudioPreviewEnabled:     true,
		ClientTranscriptionEnabled:      false,
		ClientTranscriptionAutoStart:    false,
		ClientTranscriptionModel:        defaultClientTranscriptionModel(),
		ClientTranscriptionQuantization: defaultClientTranscriptionQuantization(),
		ClientTranscriptionLanguage:     "",
	}
}

func TestGetConfigurationReturnsEmptyDefault(t *testing.T) {
	p := &Plugin{}

	assert.Equal(t, defaultClientConfiguration(), p.getConfiguration().clientConfiguration())
	assert.Equal(t, "whisper-tiny", defaultClientTranscriptionModel())
	assert.Equal(t, "hybrid", defaultClientTranscriptionQuantization())
}

func TestConfigurationEffectiveBooleansRespectExplicitFalse(t *testing.T) {
	configuration := &configuration{
		EnableVoiceMessages:          new(false),
		EnableUploadedAudioPreview:   new(false),
		EnableClientTranscription:    new(true),
		ClientTranscriptionAutoStart: new(true),
	}

	assert.False(t, configuration.voiceMessagesEnabled())
	assert.False(t, configuration.uploadedAudioPreviewEnabled())
	assert.True(t, configuration.clientTranscriptionEnabled())
	assert.True(t, configuration.clientTranscriptionAutoStart())
}

func TestConfigurationValidateRejectsInvalidValues(t *testing.T) {
	testCases := []struct {
		name          string
		configuration configuration
		wantError     string
	}{
		{
			name:          "invalid model",
			configuration: configuration{ClientTranscriptionModel: "unknown"},
			wantError:     "invalid ClientTranscriptionModel",
		},
		{
			name:          "invalid quantization",
			configuration: configuration{ClientTranscriptionQuantization: "int8"},
			wantError:     "invalid ClientTranscriptionQuantization",
		},
		{
			name:          "invalid language",
			configuration: configuration{ClientTranscriptionLanguage: "en_US"},
			wantError:     "invalid ClientTranscriptionLanguage",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.configuration.Validate()

			require.Error(t, err)
			assert.EqualError(t, err, tc.wantError)
		})
	}
}

func TestConfigurationUsesManifestTranscriptionOptions(t *testing.T) {
	configuration := configuration{
		ClientTranscriptionModel:        "moonshine-base",
		ClientTranscriptionQuantization: "fp16",
	}

	require.NoError(t, configuration.Validate())
	assert.Equal(t, "moonshine-base", configuration.clientTranscriptionModel())
	assert.Equal(t, "fp16", configuration.clientTranscriptionQuantization())
}

func TestConfigurationValidatesParakeetQuantization(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		quantization string
	}{
		{name: "default hybrid"},
		{name: "hybrid", quantization: "hybrid"},
		{name: "q8", quantization: "q8"},
		{name: "fp32", quantization: "fp32"},
	} {
		t.Run("accepts "+testCase.name, func(t *testing.T) {
			configuration := configuration{
				ClientTranscriptionModel:        "parakeet-ctc-0.6b",
				ClientTranscriptionQuantization: testCase.quantization,
			}

			require.NoError(t, configuration.Validate())
		})
	}

	for _, quantization := range []string{"q4", "fp16"} {
		t.Run("rejects "+quantization, func(t *testing.T) {
			configuration := configuration{
				ClientTranscriptionModel:        "parakeet-ctc-0.6b",
				ClientTranscriptionQuantization: quantization,
			}

			assert.EqualError(t, configuration.Validate(), "parakeet-ctc-0.6b requires hybrid, q8, or fp32 ClientTranscriptionQuantization")
		})
	}
}

func TestConfigurationTranscriptionOptionsMatchManifestSettings(t *testing.T) {
	modelSetting := findPluginSetting(clientTranscriptionModelSettingKey)
	require.NotNil(t, modelSetting)
	for _, option := range modelSetting.Options {
		require.NotNil(t, option)
		assert.True(t, isAllowedClientTranscriptionModel(option.Value), option.Value)
	}
	assert.Equal(t, modelSetting.Default, defaultClientTranscriptionModel())

	quantizationSetting := findPluginSetting(clientTranscriptionQuantizationSettingKey)
	require.NotNil(t, quantizationSetting)
	for _, option := range quantizationSetting.Options {
		require.NotNil(t, option)
		assert.True(t, isAllowedClientTranscriptionQuantization(option.Value), option.Value)
	}
	assert.Equal(t, quantizationSetting.Default, defaultClientTranscriptionQuantization())
}

func TestOnConfigurationChangeLoadsConfiguration(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.API = api

	api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).Run(func(args mock.Arguments) {
		configuration := args.Get(0).(*configuration)
		configuration.EnableClientTranscription = new(true)
		configuration.ClientTranscriptionModel = "whisper-base"
	}).Return(nil)

	require.NoError(t, p.OnConfigurationChange())
	loaded := p.getConfiguration()
	assert.True(t, loaded.clientTranscriptionEnabled())
	assert.Equal(t, "whisper-base", loaded.clientTranscriptionModel())
	api.AssertExpectations(t)
}

func TestSetConfigurationStoresClone(t *testing.T) {
	enabled := true
	configuration := &configuration{EnableClientTranscription: &enabled}
	p := &Plugin{}

	p.setConfiguration(configuration)
	enabled = false
	loaded := p.getConfiguration()
	*loaded.EnableClientTranscription = false

	assert.True(t, p.getConfiguration().clientTranscriptionEnabled())
}

func TestOnConfigurationChangeMigratesLegacyModel(t *testing.T) {
	for _, tc := range []struct {
		name          string
		precision     string
		wantPrecision string
	}{
		{name: "default", wantPrecision: "q4"},
		{name: "hybrid", precision: "hybrid", wantPrecision: "q4"},
		{name: "fp32", precision: "fp32", wantPrecision: "q4"},
		{name: "q4", precision: "q4", wantPrecision: "q4"},
		{name: "q8", precision: "q8", wantPrecision: "q8"},
		{name: "fp16", precision: "fp16", wantPrecision: "fp16"},
		{name: "whitespace", precision: " fp32 ", wantPrecision: "q4"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Given a saved configuration from browser-whisper v1.
			api := &plugintest.API{}
			p := &Plugin{}
			p.API = api
			api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).Run(func(args mock.Arguments) {
				loaded := args.Get(0).(*configuration)
				*loaded = configuration{
					EnableVoiceMessages:             new(false),
					EnableUploadedAudioPreview:      new(false),
					EnableClientTranscription:       new(true),
					ClientTranscriptionAutoStart:    new(true),
					ClientTranscriptionModel:        " whisper-large-v3 ",
					ClientTranscriptionQuantization: tc.precision,
					ClientTranscriptionLanguage:     " it ",
				}
			}).Return(nil).Twice()
			api.On("GetConfig").Return(testServerConfig(100 * 1024 * 1024)).Once()
			api.On("LogInfo", mock.Anything, "model", "whisper-large-v3-turbo", "quantization", tc.wantPrecision).Once()

			// When the saved configuration is loaded again by Mattermost.
			require.NoError(t, p.OnConfigurationChange())
			require.NoError(t, p.OnConfigurationChange())
			recorder := httptest.NewRecorder()
			p.handleGetConfig(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))

			// Then the actual client response uses a supported replacement and preserves other settings.
			require.Equal(t, http.StatusOK, recorder.Code)
			var response clientConfiguration
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, clientConfiguration{
				MaxVoiceMessageBytes:            25 * 1024 * 1024,
				MaxRecordingDurationMS:          21600000,
				VoiceMessagesEnabled:            false,
				UploadedAudioPreviewEnabled:     false,
				ClientTranscriptionEnabled:      true,
				ClientTranscriptionAutoStart:    true,
				ClientTranscriptionModel:        "whisper-large-v3-turbo",
				ClientTranscriptionQuantization: tc.wantPrecision,
				ClientTranscriptionLanguage:     "it",
			}, response)
			api.AssertExpectations(t)
		})
	}
}

func TestOnConfigurationChangeRejectsInvalidSavedConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name   string
		config configuration
	}{
		{name: "unknown model", config: configuration{ClientTranscriptionModel: "unknown"}},
		{name: "legacy invalid precision", config: configuration{ClientTranscriptionModel: "whisper-large-v3", ClientTranscriptionQuantization: "int8"}},
		{name: "legacy invalid language", config: configuration{ClientTranscriptionModel: "whisper-large-v3", ClientTranscriptionLanguage: "en_US"}},
		{name: "tdt q4", config: configuration{ClientTranscriptionModel: "parakeet-tdt-0.6b-v3", ClientTranscriptionQuantization: "q4"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Given an invalid saved configuration and an existing working configuration.
			api := &plugintest.API{}
			p := &Plugin{}
			p.API = api
			p.setConfiguration(&configuration{ClientTranscriptionModel: "whisper-base"})
			api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).Run(func(args mock.Arguments) {
				*args.Get(0).(*configuration) = tc.config
			}).Return(nil).Once()

			// When configuration loading validates the input before any migration.
			err := p.OnConfigurationChange()

			// Then activation fails validation without replacing the working configuration.
			require.Error(t, err)
			require.Equal(t, "whisper-base", p.getConfiguration().clientTranscriptionModel())
			api.AssertExpectations(t)
		})
	}
}

func TestOnConfigurationChangeAcceptsTDTPrecisions(t *testing.T) {
	for _, precision := range []string{"", "hybrid", "fp16", "q8", "fp32"} {
		t.Run(precision, func(t *testing.T) {
			// Given a supported Parakeet TDT precision.
			api := &plugintest.API{}
			p := &Plugin{}
			p.API = api
			api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).Run(func(args mock.Arguments) {
				*args.Get(0).(*configuration) = configuration{
					ClientTranscriptionModel:        "parakeet-tdt-0.6b-v3",
					ClientTranscriptionQuantization: precision,
				}
			}).Return(nil).Once()

			// When Mattermost loads the configuration.
			require.NoError(t, p.OnConfigurationChange())

			// Then client settings retain the selected model and precision.
			wantPrecision := precision
			if wantPrecision == "" {
				wantPrecision = "hybrid"
			}
			client := p.getConfiguration().clientConfiguration()
			assert.Equal(t, "parakeet-tdt-0.6b-v3", client.ClientTranscriptionModel)
			assert.Equal(t, wantPrecision, client.ClientTranscriptionQuantization)
			api.AssertExpectations(t)
		})
	}
}
