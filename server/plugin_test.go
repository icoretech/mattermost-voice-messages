package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/require"
)

func TestOnActivateInitializesRouter(t *testing.T) {
	p := &Plugin{}
	p.SetAPI(&plugintest.API{})
	p.setConfiguration(&configuration{})

	require.NoError(t, p.OnActivate())
	require.NotNil(t, p.router)
}
