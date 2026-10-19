import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { VoiceAudioPlayer } from "./voice_audio_player";

describe("VoiceAudioPlayer preview", () => {
  let audio: HTMLAudioElement;

  beforeEach(() => {
    audio = document.createElement("audio");
    vi.stubGlobal("Audio", function Audio(src: string) {
      audio.src = src;
      return audio;
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      audio.dispatchEvent(new Event("pause"));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderPreview() {
    return render(
      <VoiceAudioPlayer
        src="blob:recording-preview"
        durationMs={4000}
        waveform={Array.from({ length: 24 }, (_, index) => index / 23)}
        variant="preview"
      />,
    );
  }

  it("renders the supplied waveform and total duration without speed controls", () => {
    // Given a recording with measured waveform peaks.
    // When the preview is rendered.
    const { container } = renderPreview();

    // Then it has the accessible native scrubber and actual peak heights.
    const bars = container.querySelectorAll(".VoiceMessagePost__waveformBar");
    expect(bars).toHaveLength(24);
    expect(bars[0]).toHaveStyle({ height: "12%" });
    expect(bars[23]).toHaveStyle({ height: "100%" });
    expect(
      screen.getByRole("slider", { name: "Voice message progress" }),
    ).toHaveAttribute("type", "range");
    expect(screen.getByText("0:04")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "1x" }),
    ).not.toBeInTheDocument();
  });

  it("seeks the audio element when the preview scrubber changes", () => {
    // Given a four-second recording preview.
    const { container } = renderPreview();

    // When the native range control changes to half way.
    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });

    // Then the audio seeks and the waveform reflects the new position.
    expect(audio.currentTime).toBe(2);
    expect(screen.getByRole("slider")).toHaveValue("50");
    expect(
      container.querySelectorAll(".VoiceMessagePost__waveformBar--active"),
    ).toHaveLength(12);
    expect(screen.getByText("0:04")).toBeInTheDocument();
  });

  it("updates waveform progress when audio time advances", () => {
    // Given a recording preview with its audio at one second.
    renderPreview();
    audio.currentTime = 1;

    // When the audio reports its playback time.
    fireEvent.timeUpdate(audio);

    // Then progress updates while the total duration stays stable.
    expect(screen.getByRole("slider")).toHaveValue("25");
    expect(screen.getByText("0:04")).toBeInTheDocument();
  });

  it("plays the recording when play is pressed", async () => {
    // Given a recording preview.
    renderPreview();

    // When the user presses play.
    fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));

    // Then playback begins on the audio element and the control becomes pause.
    await screen.findByRole("button", { name: "Pause voice message" });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.playbackRate).toBe(1);
  });

  it("pauses the recording when pause is pressed", async () => {
    // Given a playing recording preview.
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
    await screen.findByRole("button", { name: "Pause voice message" });

    // When the user presses pause.
    fireEvent.click(
      screen.getByRole("button", { name: "Pause voice message" }),
    );

    // Then the audio pauses and play is available again.
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeInTheDocument();
  });
});
