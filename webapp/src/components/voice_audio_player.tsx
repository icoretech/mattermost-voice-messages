import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  getRenderableWaveformPeaks,
  peakToBarHeightPercent,
  type WaveformPeaks,
} from "../audio/waveform";

const playbackSpeeds = [0.5, 1, 1.5, 2] as const;
const waveformBars = Array.from({ length: 24 }, (_, index) => index);

type PlaybackSpeed = (typeof playbackSpeeds)[number];

export type VoiceAudioPlayerProps = {
  src: string;
  durationMs?: number;
  fallbackHref?: string;
  compact?: boolean;
  waveform?: WaveformPeaks;
  variant?: "post" | "preview";
};

type PlayerState = {
  metadataDurationMs: number;
  elapsedMs: number;
  playing: boolean;
  audioError: boolean;
};

type PlayerAction =
  | { type: "metadata-loaded"; durationMs: number }
  | { type: "time-updated"; elapsedMs: number }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "ended"; durationMs: number }
  | { type: "audio-error" };

const initialPlayerState: PlayerState = {
  metadataDurationMs: 0,
  elapsedMs: 0,
  playing: false,
  audioError: false,
};

function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "metadata-loaded":
      return {
        ...state,
        metadataDurationMs: action.durationMs,
      };
    case "time-updated":
      return {
        ...state,
        elapsedMs: action.elapsedMs,
      };
    case "playing":
      return {
        ...state,
        playing: true,
      };
    case "paused":
      return {
        ...state,
        playing: false,
      };
    case "ended":
      return {
        ...state,
        playing: false,
        elapsedMs: action.durationMs,
      };
    case "audio-error":
      return {
        ...state,
        audioError: true,
        playing: false,
      };
  }
}

function formatPlaybackTime(milliseconds: number): string {
  const safeMilliseconds = Number.isFinite(milliseconds) ? milliseconds : 0;
  const totalSeconds = Math.max(0, Math.floor(safeMilliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getAudioDurationMs(
  audio: HTMLAudioElement,
  fallbackDurationMs: number,
) {
  return Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration * 1000
    : fallbackDurationMs;
}

export function VoiceAudioPlayer(props: VoiceAudioPlayerProps) {
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  return (
    <VoiceAudioPlayerSession
      key={JSON.stringify([props.src, props.durationMs ?? 0])}
      {...props}
      speed={speed}
      onSpeedChange={setSpeed}
    />
  );
}

function VoicePlaybackButton({
  playing,
  onPause,
  onPlay,
}: {
  playing: boolean;
  onPause: () => void;
  onPlay: () => void;
}) {
  return (
    <button
      className="VoiceMessagePost__playButton"
      type="button"
      aria-label={playing ? "Pause voice message" : "Play voice message"}
      onClick={() => (playing ? onPause() : void onPlay())}
    >
      <span
        aria-hidden="true"
        className={
          playing ? "VoiceMessagePost__pauseIcon" : "VoiceMessagePost__playIcon"
        }
      />
    </button>
  );
}

function useVoiceAudioPlayback(
  src: string,
  durationMs: number,
  speed: PlaybackSpeed,
  onSpeedChange: (speed: PlaybackSpeed) => void,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);
  const resolvedDurationMs = durationMs || state.metadataDurationMs;
  const durationForProgress = resolvedDurationMs > 0 ? resolvedDurationMs : 0;
  useEffect(() => {
    if (!src) {
      audioRef.current = null;
      return undefined;
    }

    const audio = new Audio(src);
    audio.preload = "metadata";
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      if (durationMs === 0) {
        dispatch({
          type: "metadata-loaded",
          durationMs: getAudioDurationMs(audio, 0),
        });
      }
    };
    const handleTimeUpdate = () => {
      dispatch({ type: "time-updated", elapsedMs: audio.currentTime * 1000 });
    };
    const handleEnded = () => {
      dispatch({
        type: "ended",
        durationMs: getAudioDurationMs(audio, durationMs),
      });
    };
    const handlePause = () => dispatch({ type: "paused" });
    const handleError = () => dispatch({ type: "audio-error" });

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      audio.pause();
    };
  }, [src, durationMs]);

  async function playVoiceMessage() {
    const audio = audioRef.current;
    if (!audio) {
      dispatch({ type: "audio-error" });
      return;
    }

    audio.playbackRate = speed;
    try {
      await audio.play();
      if (audioRef.current === audio) dispatch({ type: "playing" });
    } catch {
      if (audioRef.current === audio) dispatch({ type: "audio-error" });
    }
  }

  function pauseVoiceMessage() {
    audioRef.current?.pause();
    dispatch({ type: "paused" });
  }

  function updateSpeed(nextSpeed: PlaybackSpeed) {
    onSpeedChange(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  }

  function seekToPercent(percent: number) {
    const audio = audioRef.current;
    if (!audio || durationForProgress === 0) {
      return;
    }

    const nextElapsedMs = (percent / 100) * durationForProgress;
    audio.currentTime = nextElapsedMs / 1000;
    dispatch({ type: "time-updated", elapsedMs: nextElapsedMs });
  }

  return {
    state,
    resolvedDurationMs,
    durationForProgress,
    playVoiceMessage,
    pauseVoiceMessage,
    updateSpeed,
    seekToPercent,
  };
}

function VoiceAudioPlayerSession({
  src,
  durationMs = 0,
  fallbackHref,
  compact = false,
  waveform,
  variant = "post",
  speed,
  onSpeedChange,
}: VoiceAudioPlayerProps & {
  speed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}) {
  const {
    state,
    resolvedDurationMs,
    durationForProgress,
    playVoiceMessage,
    pauseVoiceMessage,
    updateSpeed,
    seekToPercent,
  } = useVoiceAudioPlayback(src, durationMs, speed, onSpeedChange);
  const progressPercent = durationForProgress
    ? Math.min(100, Math.max(0, (state.elapsedMs / durationForProgress) * 100))
    : 0;
  const activeWaveformBars = Math.round(
    (progressPercent / 100) * waveformBars.length,
  );
  const waveformPeaks = getRenderableWaveformPeaks(waveform);
  const waveformBarsWithIds = waveformPeaks.map((peak, index) => ({
    active: index < activeWaveformBars,
    id: `waveform-bar-${index}`,
    peak,
  }));

  if (!src || state.audioError) {
    return (
      <div className="VoiceMessagePost VoiceMessagePost--fallback">
        <a
          href={fallbackHref || "#"}
          onClick={fallbackHref ? undefined : (event) => event.preventDefault()}
        >
          Open audio file
        </a>
      </div>
    );
  }

  if (variant === "preview") {
    return (
      <div
        className={[
          "VoiceMessagePost",
          compact ? "VoiceMessagePost--compact" : "",
          "VoiceMessagePost--preview",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <VoicePlaybackButton
          playing={state.playing}
          onPause={pauseVoiceMessage}
          onPlay={playVoiceMessage}
        />
        <span className="VoiceMessagePost__timeline">
          {formatPlaybackTime(resolvedDurationMs)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={[
        "VoiceMessagePost",
        compact ? "VoiceMessagePost--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <VoicePlaybackButton
        playing={state.playing}
        onPause={pauseVoiceMessage}
        onPlay={playVoiceMessage}
      />

      <div className="VoiceMessagePost__body">
        <label className="VoiceMessagePost__scrubberLabel">
          <span className="VoiceMessagePost__srOnly">
            Voice message progress
          </span>
          <span className="VoiceMessagePost__waveform" aria-hidden="true">
            {waveformBarsWithIds.map((bar) => (
              <span
                className={
                  bar.active
                    ? "VoiceMessagePost__waveformBar VoiceMessagePost__waveformBar--active"
                    : "VoiceMessagePost__waveformBar"
                }
                key={bar.id}
                style={{ height: `${peakToBarHeightPercent(bar.peak)}%` }}
              />
            ))}
          </span>
          <input
            className="VoiceMessagePost__scrubber"
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progressPercent}
            onChange={(event) =>
              seekToPercent(Number(event.currentTarget.value))
            }
          />
        </label>

        <div className="VoiceMessagePost__meta">
          <span className="VoiceMessagePost__timeline">
            {formatPlaybackTime(state.elapsedMs)} /{" "}
            {formatPlaybackTime(resolvedDurationMs)}
          </span>
          <span className="VoiceMessagePost__speedControls">
            {playbackSpeeds.map((playbackSpeed) => (
              <button
                className="VoiceMessagePost__speedButton"
                type="button"
                aria-pressed={speed === playbackSpeed}
                key={playbackSpeed}
                onClick={() => updateSpeed(playbackSpeed)}
              >
                {playbackSpeed}x
              </button>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
