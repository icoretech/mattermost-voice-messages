import { describe, expect, it, vi } from "vitest";
import {
  extractWaveformPeaksFromBlob,
  getRenderableWaveformPeaks,
  normalizeWaveformPeaks,
  peakToBarHeightPercent,
  waveformBarCount,
} from "./waveform";

class FakeAudioContext {
  public async decodeAudioData() {
    return {
      length: 4,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0, 0.25, 0.5, 1]),
    };
  }

  public async close() {
    return undefined;
  }
}

describe("waveform helpers", () => {
  it("normalizes supplied peaks to the player bar count", () => {
    expect(normalizeWaveformPeaks([0, 0.5, 2], 3)).toEqual([0, 0.5, 1]);
    expect(normalizeWaveformPeaks([0.1, 0.9], 4)).toEqual([0.1, 0.1, 0.9, 0.9]);
    expect(getRenderableWaveformPeaks(undefined)).toHaveLength(
      waveformBarCount,
    );
  });

  it("keeps silent bars visible", () => {
    expect(peakToBarHeightPercent(0)).toBe(12);
  });

  it("extracts peaks from decoded audio samples", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const peaks = await extractWaveformPeaksFromBlob(new Blob(["audio"]), 4);

    expect(peaks).toEqual([0, 0.25, 0.5, 1]);
  });
});
