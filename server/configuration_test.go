package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestGetConfigurationReturnsEmptyDefault(t *testing.T) {
	p := &Plugin{}

	assert.Equal(t, &configuration{}, p.getConfiguration())
}

func TestOnConfigurationChangeLoadsConfiguration(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.API = api

	api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).Return(nil)

	require.NoError(t, p.OnConfigurationChange())
	assert.Equal(t, &configuration{}, p.getConfiguration())
	api.AssertExpectations(t)
}
