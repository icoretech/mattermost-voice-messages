import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadClientConfig,
  type VoiceMessagesClientConfig,
} from "../api/client_config";
import { uploadVoiceMessage } from "../api/voice_messages";
import {
  extractWaveformPeaksFromBlob,
  getRenderableWaveformPeaks,
  type WaveformPeaks,
} from "../audio/waveform";
import { selectAudioMimeType } from "../recording/media_recorder";
import {
  type LocalTranscriptionProgress,
  transcribeVoiceMessageBlob,
} from "../transcription/client_transcription";
import { recordingLimitError } from "./recording_limits";
import { useRecordingLifecycle } from "./use_recording_lifecycle";

export type VoiceRecorderDraft = { channelId: string; rootId?: string };

export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "review"
  | "uploading"
  | "error";

export type TranscriptionStatus = "idle" | "transcribing" | "empty" | "error";

export type ReviewRecording = {
  id: number;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  url: string;
  limitError: string;
  stopNotice: string;
  waveform: WaveformPeaks;
};

export type RecorderController = {
  status: RecorderStatus;
  error: string;
  elapsedMs: number;
  recordedBytes: number;
  limits: VoiceMessagesClientConfig;
  checkingLimits: boolean;
  recheckRecordingLimits: () => Promise<void>;
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
  switch (progress.stage) {
    case "loading":
      return "Preparing model…";
    case "decoding":
      return "Preparing audio…";
    case "transcribing":
    case "done":
      return "Transcribing…";
  }
}

function useTranscriptionLifecycle() {
  const [transcript, setTranscript] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>("idle");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [transcriptionProgressLabel, setTranscriptionProgressLabel] =
    useState("");
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null);

  const abortActiveTranscription = useCallback(() => {
    transcriptionAbortControllerRef.current?.abort();
    transcriptionAbortControllerRef.current = null;
  }, []);

  const resetTranscriptionState = useCallback(() => {
    abortActiveTranscription();
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
    setTranscriptionProgressLabel("Preparing model…");
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
    const completedTranscript = text.trim();
    setTranscript(completedTranscript);
    setTranscriptionStatus(completedTranscript ? "idle" : "empty");
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
  };
}

export function useVoiceRecorderController(
  draft: VoiceRecorderDraft,
  config: VoiceMessagesClientConfig,
): RecorderController {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState("");
  const [limits, setLimits] = useState(config);
  const [checkingLimits, setCheckingLimits] = useState(false);
  const reviewLimitsAbortControllerRef = useRef<AbortController | null>(null);
  const [review, setReview] = useState<ReviewRecording | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const reviewURLRef = useRef<string | null>(null);
  const reviewSequenceRef = useRef(0);

  const {
    elapsedMs,
    recordedBytes,
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
    getStoppedDurationMs,
    stopRecording,
    getStopNotice,
    beginSession,
    abortSession,
  } = useRecordingLifecycle();

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
  } = useTranscriptionLifecycle();

  const releaseReviewURL = useCallback(() => {
    if (reviewURLRef.current) URL.revokeObjectURL(reviewURLRef.current);
    reviewURLRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      releaseReviewURL();
      uploadAbortControllerRef.current?.abort();
      reviewLimitsAbortControllerRef.current?.abort();
    };
  }, [releaseReviewURL]);

  function clearReview() {
    reviewLimitsAbortControllerRef.current?.abort();
    reviewLimitsAbortControllerRef.current = null;
    setCheckingLimits(false);
    releaseReviewURL();
    setReview(null);
  }

  async function finishRecording(
    recorder: MediaRecorder,
    selectedMimeType: string | undefined,
    signal: AbortSignal,
    recordingConfig: VoiceMessagesClientConfig,
  ) {
    if (signal.aborted) return;
    const durationMs = getStoppedDurationMs() ?? getElapsedRecordingMs();
    const mimeType = recorder.mimeType || selectedMimeType || "audio/webm";
    const blob = createBlob(mimeType);
    const stopNotice = getStopNotice();
    const limitError = recordingLimitError(
      blob.size,
      durationMs,
      recordingConfig,
    );

    stopStream();
    resetRecorder();

    if (blob.size === 0) {
      setError("Recording is empty");
      setStatus("error");
      return;
    }

    resetTranscriptionState();

    const waveform =
      (limitError ? null : await extractWaveformPeaksFromBlob(blob)) ??
      getRenderableWaveformPeaks(undefined);
    if (signal.aborted) return;
    const reviewId = reviewSequenceRef.current + 1;
    reviewSequenceRef.current = reviewId;
    const nextReview = {
      id: reviewId,
      blob,
      durationMs,
      mimeType,
      limitError,
      stopNotice,
      waveform,
      url: URL.createObjectURL(blob),
    };
    releaseReviewURL();
    reviewURLRef.current = nextReview.url;
    setReview(nextReview);
    setStatus("review");
    if (
      !limitError &&
      recordingConfig.clientTranscriptionEnabled &&
      recordingConfig.clientTranscriptionAutoStart
    ) {
      void startTranscription(nextReview);
    }
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
    const signal = beginSession();

    let stream: MediaStream;
    let recordingConfig: VoiceMessagesClientConfig;
    try {
      recordingConfig = await loadClientConfig(signal);
      if (signal.aborted) return;
      if (!recordingConfig.voiceMessagesEnabled) {
        setError("Voice messages are disabled");
        setStatus("error");
        return;
      }
      setLimits(recordingConfig);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (recordingError) {
      if (signal.aborted) return;
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not access microphone",
      );
      setStatus("error");
      return;
    }

    if (signal.aborted) {
      for (const track of stream.getTracks()) track.stop();
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
      if (!signal.aborted && event.data.size > 0) {
        appendChunk(event.data, recordingConfig);
      }
    };
    recorder.onerror = () => {
      if (signal.aborted) return;
      abortSession();
      stopStream();
      resetRecorder();
      resetTranscriptionState();
      setError("Could not record voice message");
      setStatus("error");
    };
    recorder.onstop = () =>
      void finishRecording(recorder, selectedMimeType, signal, recordingConfig);

    setRecorder(recorder);
    try {
      recorder.start(250);
      markStarted(recordingConfig);
    } catch (recordingError) {
      abortSession();
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      stopStream();
      resetRecorder();
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not start recording",
      );
      setStatus("error");
      return;
    }
    setStatus("recording");
  }

  function cancelRecording() {
    abortSession();
    const recorder = getRecorder();
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }

    uploadAbortControllerRef.current?.abort();
    uploadAbortControllerRef.current = null;
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
      if (!activeReview || activeReview.limitError) return;

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
        const currentConfig = await loadClientConfig(abortController.signal);
        if (abortController.signal.aborted) return;
        setLimits(currentConfig);
        const limitError = recordingLimitError(
          activeReview.blob.size,
          activeReview.durationMs,
          currentConfig,
        );
        if (limitError) {
          setReview({ ...activeReview, limitError });
          cancelTranscription();
          return;
        }
        if (
          !currentConfig.voiceMessagesEnabled ||
          !currentConfig.clientTranscriptionEnabled
        ) {
          cancelTranscription();
          return;
        }
        const text = await transcribeVoiceMessageBlob(
          activeReview.blob,
          activeReview.mimeType,
          {
            model: currentConfig.clientTranscriptionModel,
            quantization: currentConfig.clientTranscriptionQuantization,
            language: currentConfig.clientTranscriptionLanguage,
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
      cancelTranscription,
      clearTranscriptionAbortController,
      completeTranscription,
      failTranscription,
      review,
      setTranscript,
      setTranscriptionProgressLabel,
    ],
  );

  async function recheckRecordingLimits() {
    if (!review || checkingLimits) return;
    reviewLimitsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    reviewLimitsAbortControllerRef.current = controller;
    setCheckingLimits(true);
    setError("");
    try {
      const currentConfig = await loadClientConfig(controller.signal);
      if (controller.signal.aborted) return;
      setLimits(currentConfig);
      const limitError = currentConfig.voiceMessagesEnabled
        ? recordingLimitError(
            review.blob.size,
            review.durationMs,
            currentConfig,
          )
        : "Voice messages are disabled. Download your recording to keep a copy.";
      const waveform = limitError
        ? review.waveform
        : ((await extractWaveformPeaksFromBlob(review.blob)) ??
          review.waveform);
      if (controller.signal.aborted) return;
      setReview({ ...review, limitError, waveform });
    } catch (limitError) {
      if (controller.signal.aborted) return;
      setError(
        limitError instanceof Error
          ? limitError.message
          : "Could not check recording limits",
      );
    } finally {
      if (reviewLimitsAbortControllerRef.current === controller) {
        reviewLimitsAbortControllerRef.current = null;
        if (!controller.signal.aborted) setCheckingLimits(false);
      }
    }
  }

  async function sendRecording() {
    if (!review || uploadAbortControllerRef.current) {
      return;
    }

    abortActiveTranscription();
    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;
    setStatus("uploading");
    setError("");

    try {
      const currentConfig = await loadClientConfig(abortController.signal);
      if (abortController.signal.aborted) return;
      setLimits(currentConfig);
      const currentLimitError = recordingLimitError(
        review.blob.size,
        review.durationMs,
        currentConfig,
      );
      if (currentLimitError || !currentConfig.voiceMessagesEnabled) {
        setReview({
          ...review,
          limitError:
            currentLimitError ||
            "Voice messages are disabled. Download your recording to keep a copy.",
        });
        setStatus("review");
        return;
      }
      await uploadVoiceMessage({
        blob: review.blob,
        channelId: draft.channelId,
        rootId: draft.rootId,
        durationMs: review.durationMs,
        mimeType: review.mimeType,
        waveform: review.waveform,
        transcript: currentConfig.clientTranscriptionEnabled
          ? transcript
          : undefined,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return;
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
      setStatus("review");
    } finally {
      if (uploadAbortControllerRef.current === abortController) {
        uploadAbortControllerRef.current = null;
      }
    }
  }

  return {
    status,
    error,
    elapsedMs,
    recordedBytes,
    limits,
    checkingLimits,
    recheckRecordingLimits,
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
