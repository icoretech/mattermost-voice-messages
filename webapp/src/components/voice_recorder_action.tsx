import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadVoiceMessage } from "../api";
import {
  useVoiceMessagesClientConfig,
  type VoiceMessagesClientConfig,
} from "../client_config";
import {
  type LocalTranscriptionProgress,
  transcribeVoiceMessageBlob,
} from "../client_transcription";
import {
  maxVoiceMessageBytes,
  maxVoiceMessageDurationMs,
  minVoiceMessageDurationMs,
} from "../constants";
import { isRecordingSupported, selectAudioMimeType } from "../media_recorder";
import {
  extractWaveformPeaksFromBlob,
  getRenderableWaveformPeaks,
  type WaveformPeaks,
} from "../waveform";
import { VoiceAudioPlayer } from "./voice_audio_player";

export type VoiceRecorderActionProps = {
  draft: { channelId: string; rootId?: string };
  getSelectedText: () => { start?: number; end?: number };
  updateText: (message: string) => void;
};

type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "review"
  | "uploading"
  | "error";

type TranscriptionStatus = "idle" | "transcribing" | "error";

type ReviewRecording = {
  id: number;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  url: string;
  waveform: WaveformPeaks;
};

type RecorderController = {
  status: RecorderStatus;
  error: string;
  elapsedMs: number;
  review: ReviewRecording | null;
  recordingSupported: boolean;
  transcript: string;
  transcriptionStatus: TranscriptionStatus;
  transcriptionError: string;
  transcriptionProgressLabel: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  sendRecording: () => Promise<void>;
  setTranscript: (transcript: string) => void;
  startTranscription: () => Promise<void>;
  cancelTranscription: () => void;
};

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatTranscriptionProgress(
  progress: LocalTranscriptionProgress,
): string {
  return `${progress.stage} ${Math.round(progress.progress * 100)}%`;
}

function findComposerActionsTarget(anchor: HTMLElement | null) {
  const editorCell = anchor?.closest<HTMLElement>("#advancedTextEditorCell");
  const sendButton = editorCell?.querySelector<HTMLElement>(
    '[data-testid="SendMessageButton"]',
  );
  const target = sendButton?.parentElement?.parentElement;
  return target instanceof HTMLElement ? target : null;
}

function useComposerActionsTarget(
  anchorRef: React.RefObject<HTMLElement | null>,
) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateTarget = () =>
      setTarget(findComposerActionsTarget(anchorRef.current));
    updateTarget();

    const root =
      anchorRef.current?.closest<HTMLElement>("#advancedTextEditorCell") ??
      document.body;
    const observer = new MutationObserver(updateTarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchorRef]);

  return target;
}

function useVoiceRecorderController(
  draft: VoiceRecorderActionProps["draft"],
  config: VoiceMessagesClientConfig,
): RecorderController {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [review, setReview] = useState<ReviewRecording | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>("idle");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [transcriptionProgressLabel, setTranscriptionProgressLabel] =
    useState("");
  const [uploadAbortController, setUploadAbortController] =
    useState<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const recordingSupported = isRecordingSupported();
  const stoppedDurationMsRef = useRef<number | null>(null);
  const reviewSequenceRef = useRef(0);
  const autoStartedReviewRef = useRef<number | null>(null);
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const abortActiveTranscription = useCallback(() => {
    transcriptionAbortControllerRef.current?.abort();
    transcriptionAbortControllerRef.current = null;
  }, []);

  const resetTranscriptionState = useCallback(() => {
    abortActiveTranscription();
    autoStartedReviewRef.current = null;
    setTranscript("");
    setTranscriptionStatus("idle");
    setTranscriptionError("");
    setTranscriptionProgressLabel("");
  }, [abortActiveTranscription]);

  useEffect(() => {
    if (status !== "recording") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);

    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    return () => {
      if (review?.url) {
        URL.revokeObjectURL(review.url);
      }
    };
  }, [review?.url]);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  useEffect(() => {
    return () => abortActiveTranscription();
  }, [abortActiveTranscription]);

  useEffect(() => {
    if (!uploadAbortController) {
      return undefined;
    }

    return () => uploadAbortController.abort();
  }, [uploadAbortController]);

  function clearReview() {
    setReview(null);
  }

  function resetRecorder() {
    recorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = 0;
    stoppedDurationMsRef.current = null;
    setElapsedMs(0);
  }

  function getElapsedRecordingMs() {
    if (startedAtRef.current === 0) {
      return 0;
    }
    return Math.max(0, Date.now() - startedAtRef.current);
  }

  async function finishRecording(
    recorder: MediaRecorder,
    selectedMimeType?: string,
  ) {
    const durationMs = stoppedDurationMsRef.current ?? getElapsedRecordingMs();
    const mimeType = recorder.mimeType || selectedMimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });

    stopStream();
    resetRecorder();

    if (blob.size === 0) {
      setError("Recording is empty");
      setStatus("error");
      return;
    }

    abortActiveTranscription();
    setTranscript("");
    setTranscriptionStatus("idle");
    setTranscriptionError("");
    setTranscriptionProgressLabel("");
    autoStartedReviewRef.current = null;

    const waveform =
      (await extractWaveformPeaksFromBlob(blob)) ??
      getRenderableWaveformPeaks(undefined);
    const reviewId = reviewSequenceRef.current + 1;
    reviewSequenceRef.current = reviewId;
    setReview({
      id: reviewId,
      blob,
      durationMs,
      mimeType,
      waveform,
      url: URL.createObjectURL(blob),
    });
    setStatus("review");
  }

  async function startRecording() {
    if (!recordingSupported) {
      setError("Recording is not supported in this browser");
      setStatus("error");
      return;
    }

    if (!draft.channelId) {
      setError("Select a channel before recording");
      setStatus("error");
      return;
    }

    setError("");
    resetTranscriptionState();
    clearReview();
    setStatus("requesting-permission");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (recordingError) {
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not access microphone",
      );
      setStatus("error");
      return;
    }

    streamRef.current = stream;
    const selectedMimeType = selectAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        selectedMimeType ? { mimeType: selectedMimeType } : undefined,
      );
    } catch (recordingError) {
      stopStream();
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not start recording",
      );
      setStatus("error");
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onerror = () => {
      stopStream();
      resetRecorder();
      resetTranscriptionState();
      setError("Could not record voice message");
      setStatus("error");
    };
    recorder.onstop = () => void finishRecording(recorder, selectedMimeType);

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start();
    setStatus("recording");
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      stoppedDurationMsRef.current = getElapsedRecordingMs();
      recorder.stop();
      return;
    }

    if (recorder) {
      return;
    }

    stopStream();
    resetRecorder();
    resetTranscriptionState();
    setStatus("idle");
  }

  function cancelRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
    }

    uploadAbortController?.abort();
    setUploadAbortController(null);
    stopStream();
    resetRecorder();
    clearReview();
    resetTranscriptionState();
    setError("");
    setStatus("idle");
  }

  const startTranscription = useCallback(
    async (targetReview?: ReviewRecording) => {
      const activeReview = targetReview ?? review;
      if (!config.clientTranscriptionEnabled || !activeReview) {
        return;
      }

      abortActiveTranscription();
      const abortController = new AbortController();
      transcriptionAbortControllerRef.current = abortController;
      const reviewId = activeReview.id;

      setTranscriptionStatus("transcribing");
      setTranscriptionError("");
      setTranscriptionProgressLabel("loading 0%");

      const updateIfCurrent = (callback: () => void) => {
        if (
          abortController.signal.aborted ||
          reviewSequenceRef.current !== reviewId
        ) {
          return;
        }
        callback();
      };

      try {
        const text = await transcribeVoiceMessageBlob(
          activeReview.blob,
          activeReview.mimeType,
          {
            model: config.clientTranscriptionModel,
            quantization: config.clientTranscriptionQuantization,
            language: config.clientTranscriptionLanguage,
            signal: abortController.signal,
            onProgress: (progress) =>
              updateIfCurrent(() =>
                setTranscriptionProgressLabel(
                  formatTranscriptionProgress(progress),
                ),
              ),
            onText: (textUpdate) =>
              updateIfCurrent(() => setTranscript(textUpdate)),
          },
        );

        updateIfCurrent(() => {
          setTranscript(text);
          setTranscriptionStatus("idle");
          setTranscriptionError("");
          setTranscriptionProgressLabel("");
        });
      } catch (transcriptionError) {
        if (abortController.signal.aborted) {
          return;
        }

        updateIfCurrent(() => {
          setTranscriptionStatus("error");
          setTranscriptionError(
            transcriptionError instanceof Error
              ? transcriptionError.message
              : "Could not transcribe voice message",
          );
          setTranscriptionProgressLabel("");
        });
      } finally {
        if (transcriptionAbortControllerRef.current === abortController) {
          transcriptionAbortControllerRef.current = null;
        }
      }
    },
    [
      abortActiveTranscription,
      config.clientTranscriptionEnabled,
      config.clientTranscriptionLanguage,
      config.clientTranscriptionModel,
      config.clientTranscriptionQuantization,
      review,
    ],
  );

  useEffect(() => {
    if (
      !config.clientTranscriptionEnabled ||
      !config.clientTranscriptionAutoStart ||
      !review ||
      autoStartedReviewRef.current === review.id
    ) {
      return;
    }

    autoStartedReviewRef.current = review.id;
    void startTranscription(review);
  }, [
    config.clientTranscriptionAutoStart,
    config.clientTranscriptionEnabled,
    review,
    startTranscription,
  ]);

  async function sendRecording() {
    if (!review) {
      return;
    }

    if (review.blob.size === 0) {
      setError("Recording is empty");
      setStatus("error");
      return;
    }

    if (review.blob.size > maxVoiceMessageBytes) {
      setError("Voice message is too large");
      setStatus("error");
      return;
    }

    if (
      review.durationMs < minVoiceMessageDurationMs ||
      review.durationMs > maxVoiceMessageDurationMs
    ) {
      setError("Recording duration is invalid");
      setStatus("error");
      return;
    }

    abortActiveTranscription();
    const abortController = new AbortController();
    setUploadAbortController(abortController);
    setStatus("uploading");
    setError("");

    try {
      await uploadVoiceMessage({
        blob: review.blob,
        channelId: draft.channelId,
        rootId: draft.rootId,
        durationMs: review.durationMs,
        mimeType: review.mimeType,
        waveform: review.waveform,
        transcript: config.clientTranscriptionEnabled ? transcript : undefined,
        signal: abortController.signal,
      });
      clearReview();
      resetTranscriptionState();
      setStatus("idle");
    } catch (uploadError) {
      if (abortController.signal.aborted) {
        return;
      }
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not send voice message",
      );
      setStatus("error");
    } finally {
      setUploadAbortController((current) =>
        current === abortController ? null : current,
      );
    }
  }

  function cancelTranscription() {
    abortActiveTranscription();
    setTranscriptionStatus("idle");
    setTranscriptionProgressLabel("");
  }

  return {
    status,
    error,
    elapsedMs,
    review,
    recordingSupported,
    transcript,
    transcriptionStatus,
    transcriptionError,
    transcriptionProgressLabel,
    startRecording,
    stopRecording,
    cancelRecording,
    sendRecording,
    setTranscript,
    startTranscription: () => startTranscription(),
    cancelTranscription,
  };
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
