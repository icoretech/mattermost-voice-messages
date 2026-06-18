import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadVoiceMessage } from "../api";
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

type ReviewRecording = {
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
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  sendRecording: () => Promise<void>;
};

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
): RecorderController {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [review, setReview] = useState<ReviewRecording | null>(null);
  const [uploadAbortController, setUploadAbortController] =
    useState<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const recordingSupported = isRecordingSupported();
  const stoppedDurationMsRef = useRef<number | null>(null);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

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

    const waveform =
      (await extractWaveformPeaksFromBlob(blob)) ??
      getRenderableWaveformPeaks(undefined);
    setReview({
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
    setError("");
    setStatus("idle");
  }

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
        signal: abortController.signal,
      });
      clearReview();
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

  return {
    status,
    error,
    elapsedMs,
    review,
    recordingSupported,
    startRecording,
    stopRecording,
    cancelRecording,
    sendRecording,
  };
}

function RequestingPermissionButton() {
  return (
    <button
      className="VoiceRecorderAction__button VoiceRecorderAction__button--pending"
      disabled
      type="button"
      title="Allow microphone"
    >
      Allow microphone…
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
  onCancel,
  onSend,
  review,
}: {
  onCancel: () => void;
  onSend: () => void;
  review: ReviewRecording;
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
  const controller = useVoiceRecorderController(draft);
  const portalTarget = useComposerActionsTarget(anchorRef);

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
          review={controller.review}
          onCancel={controller.cancelRecording}
          onSend={() => void controller.sendRecording()}
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
