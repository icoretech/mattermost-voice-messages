package main

import (
	"maps"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) MessageWillBePosted(_ *plugin.Context, post *model.Post) (*model.Post, string) {
	if post == nil {
		return nil, ""
	}
	if post.Type != "" {
		return nil, ""
	}
	if _, ok := post.Props["voice_message"]; ok {
		return nil, ""
	}
	if len(post.FileIds) != 1 {
		return nil, ""
	}
	if !p.getConfiguration().uploadedAudioPreviewEnabled() {
		return nil, ""
	}

	fileInfo, appErr := p.API.GetFileInfo(post.FileIds[0])
	if appErr != nil || fileInfo == nil {
		return nil, ""
	}

	mimeType, _, ok := detectVoiceAudio(fileInfo.MimeType)
	if !ok {
		return nil, ""
	}

	updated := model.Post{}
	if err := post.ShallowCopy(&updated); err != nil {
		return nil, ""
	}

	props := model.StringInterface{}
	maps.Copy(props, post.Props)
	props["voice_message"] = buildVoiceMessageProps(fileInfo, mimeType, 0, fileInfo.Size, nil)
	updated.Props = props

	return &updated, ""
}
