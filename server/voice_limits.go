package main

import "fmt"

const (
	bytesPerMiB                        int64 = 1024 * 1024
	maxSafeJSONInteger                 int64 = 1<<53 - 1
	defaultMaxVoiceMessageSizeMB       int64 = 25
	defaultMaxRecordingDurationSeconds int64 = 6 * 60 * 60
)

type voiceLimits struct {
	maxBytes      int64
	maxDurationMS int64
}

func cloneInt64Pointer(value *int64) *int64 {
	if value == nil {
		return nil
	}
	return new(*value)
}

func (c *configuration) maxVoiceMessageSizeMB() int64 {
	if c.MaxVoiceMessageSizeMB == nil {
		return defaultMaxVoiceMessageSizeMB
	}
	return *c.MaxVoiceMessageSizeMB
}

func (c *configuration) maxRecordingDurationSeconds() int64 {
	if c.MaxRecordingDurationSeconds == nil {
		return defaultMaxRecordingDurationSeconds
	}
	return *c.MaxRecordingDurationSeconds
}

func (c *configuration) validateVoiceLimits() error {
	if size := c.maxVoiceMessageSizeMB(); size < 0 || size > maxSafeJSONInteger/bytesPerMiB {
		return fmt.Errorf("invalid MaxVoiceMessageSizeMB")
	}
	if duration := c.maxRecordingDurationSeconds(); duration < 0 || duration > maxSafeJSONInteger/1000 {
		return fmt.Errorf("invalid MaxRecordingDurationSeconds")
	}
	return nil
}

func (p *Plugin) voiceLimits(configuration *configuration) (voiceLimits, error) {
	if err := configuration.validateVoiceLimits(); err != nil {
		return voiceLimits{}, err
	}
	if p.API == nil {
		return voiceLimits{}, fmt.Errorf("mattermost file size limit is unavailable")
	}
	serverConfiguration := p.API.GetConfig()
	if serverConfiguration == nil || serverConfiguration.FileSettings.MaxFileSize == nil {
		return voiceLimits{}, fmt.Errorf("mattermost file size limit is unavailable")
	}
	serverMaxBytes := *serverConfiguration.FileSettings.MaxFileSize
	if serverMaxBytes <= 0 || serverMaxBytes > maxSafeJSONInteger {
		return voiceLimits{}, fmt.Errorf("invalid Mattermost file size limit")
	}
	maxBytes := configuration.maxVoiceMessageSizeMB() * bytesPerMiB
	if maxBytes == 0 || maxBytes > serverMaxBytes {
		maxBytes = serverMaxBytes
	}
	return voiceLimits{maxBytes: maxBytes, maxDurationMS: configuration.maxRecordingDurationSeconds() * 1000}, nil
}
