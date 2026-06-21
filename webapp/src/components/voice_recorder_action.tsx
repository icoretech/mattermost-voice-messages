import React, { useRef } from "react";
import { createPortal } from "react-dom";
import { useVoiceMessagesClientConfig } from "../api/client_config";
import { useComposerActionsTarget } from "../voice_recorder/use_composer_actions_target";
import {
  type ReviewRecording,
  type TranscriptionStatus,
  useVoiceRecorderController,
  type VoiceRecorderDraft,
} from "../voice_recorder/use_voice_recorder_controller";
import { VoiceAudioPlayer } from "./voice_audio_player";

export type VoiceRecorderActionProps = {
  draft: VoiceRecorderDraft;
};

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function RequestingPermissionButton() {
  return (
    <button
      className="VoiceRecorderAction__button VoiceRecorderAction__button--pending"
      disabled
      type="button"
      aria-label="Requesting microphone permission"
      title="Requesting microphone permission"
    >
      <MicIcon />
    </button>
  );
}

function RecordingPanel({
  elapsedMs,
  onCancel,
  onStop,
}: {
  elapsedMs: number;
  onCancel: () => void;
  onStop: () => void;
}) {
  return (
    <div className="VoiceRecorderAction VoiceRecorderAction__panel VoiceRecorderAction__panel--recording">
      <span className="VoiceRecorderAction__recordingDot" aria-hidden="true" />
      <span className="VoiceRecorderAction__timer" aria-live="polite">
        {formatElapsedTime(elapsedMs)}
      </span>
      <span className="VoiceRecorderAction__recordingLabel">Recording</span>
      <button
        className="VoiceRecorderAction__iconButton VoiceRecorderAction__iconButton--stop"
        type="button"
        aria-label="Stop recording"
        title="Stop recording"
        onClick={onStop}
      />
      <button
        className="VoiceRecorderAction__iconButton VoiceRecorderAction__iconButton--cancel"
        type="button"
        aria-label="Cancel recording"
        title="Cancel recording"
        onClick={onCancel}
      />
    </div>
  );
}

function ReviewPanel({
  clientTranscriptionEnabled,
  onCancel,
  onCancelTranscription,
  onSend,
  onStartTranscription,
  onTranscriptChange,
  review,
  transcript,
  transcriptionError,
  transcriptionProgressLabel,
  transcriptionStatus,
}: {
  clientTranscriptionEnabled: boolean;
  onCancel: () => void;
  onCancelTranscription: () => void;
  onSend: () => void;
  onStartTranscription: () => void;
  onTranscriptChange: (value: string) => void;
  review: ReviewRecording;
  transcript: string;
  transcriptionError: string;
  transcriptionProgressLabel: string;
  transcriptionStatus: TranscriptionStatus;
}) {
  return (
    <div className="VoiceRecorderAction VoiceRecorderAction__panel VoiceRecorderAction__panel--review">
      <VoiceAudioPlayer
        src={review.url}
        durationMs={review.durationMs}
        compact
        waveform={review.waveform}
        variant="preview"
      />
      {clientTranscriptionEnabled ? (
        <div className="VoiceRecorderAction__transcription">
          {transcriptionStatus === "transcribing" ? (
            <div className="VoiceRecorderAction__transcriptionStatus">
              <span>Transcribing locally…</span>
              {transcriptionProgressLabel ? (
                <span>{transcriptionProgressLabel}</span>
              ) : null}
              <button
                className="VoiceRecorderAction__transcriptionButton"
                type="button"
                aria-label="Cancel transcription"
                onClick={onCancelTranscription}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {transcriptionStatus === "error" ? (
            <div className="VoiceRecorderAction__transcriptionStatus VoiceRecorderAction__transcriptionStatus--error">
              <span
                className="VoiceRecorderAction__transcriptionAlert"
                role="alert"
              >
                {transcriptionError}
              </span>
              <button
                className="VoiceRecorderAction__transcriptionButton"
                type="button"
                aria-label="Transcribe voice message locally"
                onClick={onStartTranscription}
              >
                Transcribe locally
              </button>
            </div>
          ) : null}
          {transcript ? (
            <>
              <textarea
                className="VoiceRecorderAction__transcriptTextarea"
                aria-label="Voice message transcript"
                value={transcript}
                onChange={(event) => onTranscriptChange(event.target.value)}
              />
              <span className="VoiceRecorderAction__transcriptionHelp">
                Transcript will be sent as the message text. Edit or clear it
                before sending.
              </span>
            </>
          ) : null}
          {transcriptionStatus === "idle" && !transcript ? (
            <button
              className="VoiceRecorderAction__transcriptionButton"
              type="button"
              aria-label="Transcribe voice message locally"
              onClick={onStartTranscription}
            >
              Transcribe locally
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="VoiceRecorderAction__reviewActions">
        <button
          className="VoiceRecorderAction__sendButton"
          type="button"
          aria-label="Send voice message"
          title="Send voice message"
          onClick={onSend}
        >
          Send
        </button>
        <button
          className="VoiceRecorderAction__iconButton VoiceRecorderAction__iconButton--cancel"
          type="button"
          aria-label="Cancel recording"
          title="Cancel recording"
          onClick={onCancel}
        />
      </div>
    </div>
  );
}

function UploadingPanel() {
  return (
    <div className="VoiceRecorderAction VoiceRecorderAction__panel VoiceRecorderAction__panel--uploading">
      <span className="VoiceRecorderAction__spinner" aria-hidden="true" />
      <span>Sending…</span>
    </div>
  );
}

function ErrorPanel({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="VoiceRecorderAction VoiceRecorderAction__panel VoiceRecorderAction__panel--error">
      <span role="alert">{error}</span>
      <button
        className="VoiceRecorderAction__button"
        type="button"
        aria-label="Record voice message"
        title="Record voice message"
        onClick={onRetry}
      >
        <MicIcon />
      </button>
    </div>
  );
}

function MicIcon() {
  return (
    <span className="VoiceRecorderAction__micIcon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3Z"
          fill="currentColor"
        />
        <path
          d="M17.3 11a1 1 0 1 0-2 0 3.3 3.3 0 0 1-6.6 0 1 1 0 1 0-2 0 5.31 5.31 0 0 0 4.3 5.2V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.8a5.31 5.31 0 0 0 4.3-5.2Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function IdleMicButton({
  disabled,
  onRecord,
}: {
  disabled: boolean;
  onRecord: () => void;
}) {
  return (
    <button
      className="VoiceRecorderAction__button"
      disabled={disabled}
      type="button"
      aria-label="Record voice message"
      title="Record voice message"
      onClick={onRecord}
    >
      <MicIcon />
    </button>
  );
}

export function VoiceRecorderAction({ draft }: VoiceRecorderActionProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const { config, loading } = useVoiceMessagesClientConfig();
  const controller = useVoiceRecorderController(draft, config);
  const portalTarget = useComposerActionsTarget(anchorRef);

  if (loading || !config.voiceMessagesEnabled) {
    return null;
  }

  let content: React.ReactNode;
  switch (controller.status) {
    case "requesting-permission":
      content = <RequestingPermissionButton />;
      break;
    case "recording":
      content = (
        <RecordingPanel
          elapsedMs={controller.elapsedMs}
          onCancel={controller.cancelRecording}
          onStop={controller.stopRecording}
        />
      );
      break;
    case "review":
      content = controller.review ? (
        <ReviewPanel
          clientTranscriptionEnabled={config.clientTranscriptionEnabled}
          review={controller.review}
          transcript={controller.transcript}
          transcriptionStatus={controller.transcriptionStatus}
          transcriptionError={controller.transcriptionError}
          transcriptionProgressLabel={controller.transcriptionProgressLabel}
          onCancel={controller.cancelRecording}
          onCancelTranscription={controller.cancelTranscription}
          onSend={() => void controller.sendRecording()}
          onStartTranscription={() => void controller.startTranscription()}
          onTranscriptChange={controller.setTranscript}
        />
      ) : null;
      break;
    case "uploading":
      content = <UploadingPanel />;
      break;
    case "error":
      content = (
        <ErrorPanel
          error={controller.error}
          onRetry={() => void controller.startRecording()}
        />
      );
      break;
    case "idle":
      content = (
        <IdleMicButton
          disabled={!controller.recordingSupported || !draft.channelId}
          onRecord={() => void controller.startRecording()}
        />
      );
      break;
  }

  return (
    <>
      <span className="VoiceRecorderAction__anchor" ref={anchorRef} />
      {portalTarget ? createPortal(content, portalTarget) : content}
    </>
  );
}
