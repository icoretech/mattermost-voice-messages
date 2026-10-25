package main

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/require"
)

func TestVoiceTranscriptFitsLegacyPostStorage(t *testing.T) {
	const legacyMaxRunes = 16383
	const legacyMaxBytes = 65535

	for _, character := range []string{"a", "\U0001f600"} {
		for _, extraRunes := range []int{0, 1} {
			name := "at limit"
			if extraRunes > 0 {
				name = "over limit"
			}
			t.Run(character+" "+name, func(t *testing.T) {
				transcript := strings.Repeat(character, legacyMaxRunes+extraRunes)
				channelID := model.NewId()
				req := newVoiceMultipartRequest(t, map[string]string{
					"channel_id": channelID,
					"transcript": transcript,
				}, "voice.webm", "audio/webm", validWebMAudioBytes())

				parsed, handlerErr := parseVoiceMessageRequest(req, maxVoiceMessageBytes, true)

				require.Nil(t, handlerErr)
				if extraRunes == 0 {
					require.Equal(t, transcript, parsed.transcript)
				} else {
					require.Equal(t, strings.Repeat(character, legacyMaxRunes-1)+"…", parsed.transcript)
				}
				require.True(t, utf8.ValidString(parsed.transcript))
				require.LessOrEqual(t, len(parsed.transcript), legacyMaxBytes)
				post := &model.Post{
					Id:        model.NewId(),
					CreateAt:  1,
					UpdateAt:  1,
					UserId:    model.NewId(),
					ChannelId: channelID,
					Message:   parsed.transcript,
				}
				require.Nil(t, post.IsValid(legacyMaxRunes))
			})
		}
	}
}
