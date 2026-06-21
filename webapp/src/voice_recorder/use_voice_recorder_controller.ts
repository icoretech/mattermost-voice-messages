import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceMessagesClientConfig } from "../api/client_config";
import { uploadVoiceMessage } from "../api/voice_messages";
import {
  extractWaveformPeaksFromBlob,
  getRenderableWaveformPeaks,
  type WaveformPeaks,
} from "../audio/waveform";
import {
  maxVoiceMessageBytes,
  maxVoiceMessageDurationMs,
  minVoiceMessageDurationMs,
} from "../constants";
import {
  isRecordingSupported,
  selectAudioMimeType,
} from "../recording/media_recorder";
import {
  type LocalTranscriptionProgress,
  transcribeVoiceMessageBlob,
} from "../transcription/client_transcription";

export type VoiceRecorderDraft = { channelId: string; rootId?: string };

export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "review"
  | "uploading"
  | "error";

export type TranscriptionStatus = "idle" | "transcribing" | "error";

export type ReviewRecording = {
  id: number;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  url: string;
  waveform: WaveformPeaks;
};

export type RecorderController = {
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

function formatTranscriptionProgress(
  progress: LocalTranscriptionProgress,
): string {
  return `${progress.stage} ${Math.round(progress.progress * 100)}%`;
}

function useRecordingLifecycle(status: RecorderStatus) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stoppedDurationMsRef = useRef<number | null>(null);
  const recordingSupported = isRecordingSupported();

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = 0;
    stoppedDurationMsRef.current = null;
    setElapsedMs(0);
  }, []);

  const getElapsedRecordingMs = useCallback(() => {
    if (startedAtRef.current === 0) {
      return 0;
    }
    return Math.max(0, Date.now() - startedAtRef.current);
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
    return () => stopStream();
  }, [stopStream]);

  const setStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
  }, []);

  const getRecorder = useCallback(() => recorderRef.current, []);

  const setRecorder = useCallback((recorder: MediaRecorder) => {
    recorderRef.current = recorder;
  }, []);

  const resetChunks = useCallback(() => {
    chunksRef.current = [];
  }, []);

  const appendChunk = useCallback((chunk: Blob) => {
    chunksRef.current.push(chunk);
  }, []);

  const createBlob = useCallback(
    (mimeType: string) => new Blob(chunksRef.current, { type: mimeType }),
    [],
  );

  const markStarted = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
  }, []);

  const captureStoppedDuration = useCallback(() => {
    stoppedDurationMsRef.current = getElapsedRecordingMs();
  }, [getElapsedRecordingMs]);

  const getStoppedDurationMs = useCallback(
    () => stoppedDurationMsRef.current,
    [],
  );

  return {
    elapsedMs,
    recordingSupported,
    stopStream,
    resetRecorder,
    getElapsedRecordingMs,
    setStream,
    getRecorder,
    setRecorder,
    resetChunks,
    appendChunk,
    createBlob,
    markStarted,
    captureStoppedDuration,
    getStoppedDurationMs,
  };
}

function useTranscriptionLifecycle() {
  const [transcript, setTranscript] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>("idle");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [transcriptionProgressLabel, setTranscriptionProgressLabel] =
    useState("");
  const autoStartedReviewRef = useRef<number | null>(null);
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null);

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
    return () => abortActiveTranscription();
  }, [abortActiveTranscription]);

  const beginTranscription = useCallback(() => {
    abortActiveTranscription();
    const abortController = new AbortController();
    transcriptionAbortControllerRef.current = abortController;
    setTranscriptionStatus("transcribing");
    setTranscriptionError("");
    setTranscriptionProgressLabel("loading 0%");
    return abortController;
  }, [abortActiveTranscription]);

  const clearTranscriptionAbortController = useCallback(
    (abortController: AbortController) => {
      if (transcriptionAbortControllerRef.current === abortController) {
        transcriptionAbortControllerRef.current = null;
      }
    },
    [],
  );

  const completeTranscription = useCallback((text: string) => {
    setTranscript(text);
    setTranscriptionStatus("idle");
    setTranscriptionError("");
    setTranscriptionProgressLabel("");
  }, []);

  const failTranscription = useCallback((message: string) => {
    setTranscriptionStatus("error");
    setTranscriptionError(message);
    setTranscriptionProgressLabel("");
  }, []);

  const cancelTranscription = useCallback(() => {
    abortActiveTranscription();
    setTranscriptionStatus("idle");
    setTranscriptionProgressLabel("");
  }, [abortActiveTranscription]);

  const hasAutoStartedReview = useCallback(
    (reviewId: number) => autoStartedReviewRef.current === reviewId,
    [],
  );

  const markAutoStartedReview = useCallback((reviewId: number) => {
    autoStartedReviewRef.current = reviewId;
  }, []);

  return {
    transcript,
    setTranscript,
    transcriptionStatus,
    transcriptionError,
    transcriptionProgressLabel,
    setTranscriptionProgressLabel,
    abortActiveTranscription,
    resetTranscriptionState,
    beginTranscription,
    clearTranscriptionAbortController,
    completeTranscription,
    failTranscription,
    cancelTranscription,
    hasAutoStartedReview,
    markAutoStartedReview,
  };
}

export function useVoiceRecorderController(
  draft: VoiceRecorderDraft,
  config: VoiceMessagesClientConfig,
): RecorderController {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState("");
  const [review, setReview] = useState<ReviewRecording | null>(null);
  const [uploadAbortController, setUploadAbortController] =
    useState<AbortController | null>(null);
  const reviewSequenceRef = useRef(0);

  const {
    elapsedMs,
    recordingSupported,
    stopStream,
    resetRecorder,
    getElapsedRecordingMs,
    setStream,
    getRecorder,
    setRecorder,
    resetChunks,
    appendChunk,
    createBlob,
    markStarted,
    captureStoppedDuration,
    getStoppedDurationMs,
  } = useRecordingLifecycle(status);

  const {
    transcript,
    setTranscript,
    transcriptionStatus,
    transcriptionError,
    transcriptionProgressLabel,
    setTranscriptionProgressLabel,
    abortActiveTranscription,
    resetTranscriptionState,
    beginTranscription,
    clearTranscriptionAbortController,
    completeTranscription,
    failTranscription,
    cancelTranscription,
    hasAutoStartedReview,
    markAutoStartedReview,
  } = useTranscriptionLifecycle();

  useEffect(() => {
    return () => {
      if (review?.url) {
        URL.revokeObjectURL(review.url);
      }
    };
  }, [review?.url]);

  useEffect(() => {
    if (!uploadAbortController) {
      return undefined;
    }

    return () => uploadAbortController.abort();
  }, [uploadAbortController]);

  function clearReview() {
    setReview(null);
  }

  async function finishRecording(
    recorder: MediaRecorder,
    selectedMimeType?: string,
  ) {
    const durationMs = getStoppedDurationMs() ?? getElapsedRecordingMs();
    const mimeType = recorder.mimeType || selectedMimeType || "audio/webm";
    const blob = createBlob(mimeType);

    stopStream();
    resetRecorder();

    if (blob.size === 0) {
      setError("Recording is empty");
      setStatus("error");
      return;
    }

    resetTranscriptionState();

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

    setStream(stream);
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

    resetChunks();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        appendChunk(event.data);
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

    setRecorder(recorder);
    markStarted();
    recorder.start();
    setStatus("recording");
  }

  function stopRecording() {
    const recorder = getRecorder();
    if (recorder?.state === "recording") {
      captureStoppedDuration();
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
    const recorder = getRecorder();
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

      const abortController = beginTranscription();
      const reviewId = activeReview.id;

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

        updateIfCurrent(() => completeTranscription(text));
      } catch (transcriptionError) {
        if (abortController.signal.aborted) {
          return;
        }

        updateIfCurrent(() =>
          failTranscription(
            transcriptionError instanceof Error
              ? transcriptionError.message
              : "Could not transcribe voice message",
          ),
        );
      } finally {
        clearTranscriptionAbortController(abortController);
      }
    },
    [
      beginTranscription,
      clearTranscriptionAbortController,
      completeTranscription,
      config.clientTranscriptionEnabled,
      config.clientTranscriptionLanguage,
      config.clientTranscriptionModel,
      config.clientTranscriptionQuantization,
      failTranscription,
      review,
      setTranscript,
      setTranscriptionProgressLabel,
    ],
  );

  useEffect(() => {
    if (
      !config.clientTranscriptionEnabled ||
      !config.clientTranscriptionAutoStart ||
      !review ||
      hasAutoStartedReview(review.id)
    ) {
      return;
    }

    markAutoStartedReview(review.id);
    void startTranscription(review);
  }, [
    config.clientTranscriptionAutoStart,
    config.clientTranscriptionEnabled,
    hasAutoStartedReview,
    markAutoStartedReview,
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
