import "@testing-library/jest-dom/vitest";
import type { Post } from "@mattermost/types/posts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { VoicePostComponent } from "./voice_post";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-id",
    create_at: 0,
    update_at: 123,
    edit_at: 0,
    delete_at: 0,
    is_pinned: false,
    user_id: "user-id",
    channel_id: "channel-id",
    root_id: "",
    original_id: "",
    message: "Voice message",
    type: "custom_spillage_report",
    props: {},
    hashtags: "",
    pending_post_id: "",
    reply_count: 0,
    metadata: {
      embeds: [],
      emojis: [],
      files: [],
      images: {},
    },
    ...overrides,
  };
}

let createdAudios: HTMLAudioElement[] = [];

function FakeAudio(_src?: string) {
  const audio = document.createElement("audio");
  if (_src) {
    audio.setAttribute("src", _src);
  }
  createdAudios.push(audio);
  return audio;
}

function installAudioFactory() {
  vi.stubGlobal("Audio", FakeAudio);
}

function getCreatedAudio() {
  const audio = createdAudios.at(-1);
  if (!audio) {
    throw new Error("Expected VoiceAudioPlayer to create an audio element");
  }
  return audio;
}

describe("VoicePostComponent", () => {
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;

  beforeEach(() => {
    createdAudios = [];
    HTMLMediaElement.prototype.pause = vi.fn();
    installAudioFactory();
  });

  afterEach(() => {
    cleanup();
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    vi.unstubAllGlobals();
  });

  it("uses voice message props before post file ids", () => {
    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["fallback-file"],
          props: {
            voice_message: {
              file_id: "prop-file",
              duration_ms: 65_000,
            },
          },
        })}
      />,
    );

    expect(getCreatedAudio()).toHaveAttribute(
      "src",
      "/api/v4/files/prop-file?t=123",
    );
    expect(screen.getByText("0:00 / 1:05")).toBeInTheDocument();
  });

  it("ignores invalid voice message props when falling back", () => {
    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["fallback-file"],
          props: { voice_message: [] },
        })}
      />,
    );

    expect(getCreatedAudio()).toHaveAttribute(
      "src",
      "/api/v4/files/fallback-file?t=123",
    );
  });

  it("renders a skinned waveform scrubber", () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("audio"));
    vi.stubGlobal("fetch", fetchMock);
    const arrayBufferSpy = vi.spyOn(Response.prototype, "arrayBuffer");
    const decodeAudioData = vi.fn();
    class FakeWaveformAudioContext {
      public async decodeAudioData() {
        decodeAudioData();
        return {
          getChannelData: () => new Float32Array(),
          length: 0,
          numberOfChannels: 0,
        };
      }

      public async close() {
        return undefined;
      }
    }
    vi.stubGlobal("AudioContext", FakeWaveformAudioContext);

    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 2_000 } },
        })}
      />,
    );

    expect(
      document.querySelectorAll(".VoiceMessagePost__waveformBar"),
    ).toHaveLength(24);
    expect(
      screen.getByRole("slider", { name: "Voice message progress" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it("uses persisted waveform peaks for bar heights", () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("audio"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["file-id"],
          props: {
            voice_message: {
              duration_ms: 2_000,
              waveform: Array.from({ length: 24 }, (_, index) => index / 23),
            },
          },
        })}
      />,
    );

    const bars = document.querySelectorAll<HTMLElement>(
      ".VoiceMessagePost__waveformBar",
    );
    expect(bars[0]).toHaveStyle({ height: "12%" });
    expect(bars[23]).toHaveStyle({ height: "100%" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("seeks through the waveform scrubber", () => {
    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 4_000 } },
        })}
      />,
    );

    fireEvent.change(
      screen.getByRole("slider", { name: "Voice message progress" }),
      {
        target: { value: "50" },
      },
    );

    expect(getCreatedAudio().currentTime).toBe(2);
    expect(screen.getByText("0:02 / 0:04")).toBeInTheDocument();
  });

  it("falls back to post file ids", () => {
    render(
      <VoicePostComponent post={makePost({ file_ids: ["fallback-file"] })} />,
    );

    expect(getCreatedAudio()).toHaveAttribute(
      "src",
      "/api/v4/files/fallback-file?t=123",
    );
  });

  it("plays, pauses, and changes playback speed", async () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;

    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 2_000 } },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1.5x" }));
    expect(getCreatedAudio().playbackRate).toBe(1.5);

    fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
    await screen.findByRole("button", { name: "Pause voice message" });
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Pause voice message" }),
    );
    expect(pause).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeInTheDocument();
  });

  it("sets selected speed button with aria-pressed", () => {
    render(<VoicePostComponent post={makePost({ file_ids: ["file-id"] })} />);

    fireEvent.click(screen.getByRole("button", { name: "2x" }));

    expect(screen.getByRole("button", { name: "2x" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("resets playing state when audio ends", async () => {
    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);

    render(
      <VoicePostComponent
        post={makePost({
          file_ids: ["file-id"],
          props: { voice_message: { duration_ms: 2_000 } },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
    await screen.findByRole("button", { name: "Pause voice message" });

    fireEvent.ended(getCreatedAudio());

    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0:02 / 0:02")).toBeInTheDocument();
  });

  it("shows fallback link without a file id", () => {
    render(<VoicePostComponent post={makePost()} />);

    expect(
      screen.getByRole("link", { name: "Open audio file" }),
    ).toHaveAttribute("href", "#");
  });
});
