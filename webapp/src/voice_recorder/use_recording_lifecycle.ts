import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceMessagesClientConfig } from "../api/client_config";
import { isRecordingSupported } from "../recording/media_recorder";

type StopReason = "manual" | "duration" | "size";

export function useRecordingLifecycle() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const stoppedDurationMsRef = useRef<number | null>(null);
  const stopReasonRef = useRef<StopReason>("manual");
  const intervalRef = useRef<number | null>(null);
  const sessionRef = useRef<AbortController | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const abortSession = useCallback(() => {
    clearTimer();
    sessionRef.current?.abort();
    sessionRef.current = null;
  }, [clearTimer]);

  const beginSession = useCallback(() => {
    abortSession();
    const controller = new AbortController();
    sessionRef.current = controller;
    return controller.signal;
  }, [abortSession]);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    clearTimer();
    recorderRef.current = null;
    chunksRef.current = [];
    bytesRef.current = 0;
    startedAtRef.current = null;
    stoppedDurationMsRef.current = null;
    stopReasonRef.current = "manual";
    setElapsedMs(0);
    setRecordedBytes(0);
  }, [clearTimer]);

  const getElapsedRecordingMs = useCallback(() => {
    return startedAtRef.current === null
      ? 0
      : Math.max(0, Date.now() - startedAtRef.current);
  }, []);

  const stop = useCallback(
    (reason: StopReason, durationLimitMs = 0) => {
      const recorder = recorderRef.current;
      if (recorder?.state !== "recording") return;
      clearTimer();
      // The deadline is the intended recording end; event-loop/flush latency must
      // not turn our duration auto-stop into a recording rejected by the server.
      stoppedDurationMsRef.current =
        reason === "duration" ? durationLimitMs : getElapsedRecordingMs();
      stopReasonRef.current = reason;
      setElapsedMs(stoppedDurationMsRef.current);
      recorder.stop();
      stopStream();
    },
    [clearTimer, getElapsedRecordingMs, stopStream],
  );

  useEffect(
    () => () => {
      abortSession();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      stopStream();
    },
    [abortSession, stopStream],
  );

  const setStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
  }, []);
  const getRecorder = useCallback(() => recorderRef.current, []);
  const setRecorder = useCallback((recorder: MediaRecorder) => {
    recorderRef.current = recorder;
  }, []);
  const resetChunks = useCallback(() => {
    chunksRef.current = [];
    bytesRef.current = 0;
    stopReasonRef.current = "manual";
    setRecordedBytes(0);
  }, []);
  const appendChunk = useCallback(
    (chunk: Blob, limits: VoiceMessagesClientConfig) => {
      chunksRef.current.push(chunk);
      bytesRef.current += chunk.size;
      setRecordedBytes(bytesRef.current);
      if (
        limits.maxRecordingDurationMs > 0 &&
        getElapsedRecordingMs() >= limits.maxRecordingDurationMs
      ) {
        stop("duration", limits.maxRecordingDurationMs);
        return;
      }
      // Keep every container chunk. Reserve 5% for the final flush, which can
      // still overshoot when browsers delay chunks; review checks the full Blob.
      if (
        bytesRef.current >=
        Math.max(1, Math.floor(limits.maxVoiceMessageBytes * 0.95))
      )
        stop("size");
    },
    [getElapsedRecordingMs, stop],
  );
  const createBlob = useCallback(
    (mimeType: string) => new Blob(chunksRef.current, { type: mimeType }),
    [],
  );
  const markStarted = useCallback(
    (limits: VoiceMessagesClientConfig) => {
      startedAtRef.current = Date.now();
      stoppedDurationMsRef.current = null;
      setElapsedMs(0);
      clearTimer();
      intervalRef.current = window.setInterval(() => {
        const elapsed = getElapsedRecordingMs();
        setElapsedMs(elapsed);
        if (
          limits.maxRecordingDurationMs > 0 &&
          elapsed >= limits.maxRecordingDurationMs
        ) {
          stop("duration", limits.maxRecordingDurationMs);
        }
      }, 250);
    },
    [clearTimer, getElapsedRecordingMs, stop],
  );
  const getStoppedDurationMs = useCallback(
    () => stoppedDurationMsRef.current,
    [],
  );
  const getStopNotice = useCallback(() => {
    switch (stopReasonRef.current) {
      case "manual":
        return "";
      case "duration":
        return "Stopped automatically at the duration limit.";
      case "size":
        return "Stopped automatically near the file size limit.";
    }
  }, []);
  const stopRecording = useCallback(() => stop("manual"), [stop]);

  return {
    elapsedMs,
    recordedBytes,
    recordingSupported: isRecordingSupported(),
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
    getStopNotice,
    stopRecording,
    beginSession,
    abortSession,
  };
}
