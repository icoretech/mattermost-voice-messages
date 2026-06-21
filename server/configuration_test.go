package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func defaultClientConfiguration() clientConfiguration {
	return clientConfiguration{
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
