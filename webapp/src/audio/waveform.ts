export const waveformBarCount = 24;

const minimumVisiblePeak = 0.12;
const unknownWaveformPeak = 0.32;

export type WaveformPeaks = number[];

type BrowserAudioContext = AudioContext & {
  close: () => Promise<void>;
};

type AudioContextConstructor = new () => BrowserAudioContext;

export function normalizeWaveformPeaks(
  value: unknown,
  barCount = waveformBarCount,
): WaveformPeaks | undefined {
  if (!Array.isArray(value) || value.length === 0 || barCount <= 0) {
    return undefined;
  }

  const peaks: number[] = [];
  for (const valuePeak of value) {
    const peak = typeof valuePeak === "number" ? valuePeak : Number(valuePeak);
    if (Number.isFinite(peak)) {
      peaks.push(Math.min(1, Math.max(0, peak)));
    }
  }
  if (peaks.length === 0) {
    return undefined;
  }

  if (peaks.length === barCount) {
    return peaks;
  }

  return Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index * peaks.length) / barCount);
    const end = Math.max(
      start + 1,
      Math.ceil(((index + 1) * peaks.length) / barCount),
    );
    let peak = 0;
    for (let peakIndex = start; peakIndex < end; peakIndex += 1) {
      peak = Math.max(peak, peaks[peakIndex] ?? 0);
    }
    return peak;
  });
}

export function getRenderableWaveformPeaks(
  peaks: WaveformPeaks | undefined,
  barCount = waveformBarCount,
): WaveformPeaks {
  return (
    normalizeWaveformPeaks(peaks, barCount) ??
    Array.from({ length: barCount }, () => unknownWaveformPeak)
  );
}

export function peakToBarHeightPercent(peak: number): number {
  const normalizedPeak = Math.min(1, Math.max(minimumVisiblePeak, peak));
  return Math.round(normalizedPeak * 100);
}

export async function extractWaveformPeaksFromBlob(
  blob: Blob,
  barCount = waveformBarCount,
): Promise<WaveformPeaks | undefined> {
  return extractWaveformPeaksFromArrayBuffer(
    await blob.arrayBuffer(),
    barCount,
  );
}

async function extractWaveformPeaksFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  barCount: number,
): Promise<WaveformPeaks | undefined> {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor || arrayBuffer.byteLength === 0) {
    return undefined;
  }

  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0),
    );
    return extractWaveformPeaksFromAudioBuffer(audioBuffer, barCount);
  } catch {
    return undefined;
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

function extractWaveformPeaksFromAudioBuffer(
  audioBuffer: AudioBuffer,
  barCount: number,
): WaveformPeaks | undefined {
  if (audioBuffer.length === 0 || audioBuffer.numberOfChannels === 0) {
    return undefined;
  }

  const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / barCount));
  const peaks = Array.from({ length: barCount }, (_, barIndex) => {
    const start = barIndex * samplesPerBar;
    const end =
      barIndex === barCount - 1
        ? audioBuffer.length
        : Math.min(audioBuffer.length, start + samplesPerBar);
    let sum = 0;
    let sampleCount = 0;

    for (
      let channel = 0;
      channel < audioBuffer.numberOfChannels;
      channel += 1
    ) {
      const data = audioBuffer.getChannelData(channel);
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        sum += data[sampleIndex] ** 2;
        sampleCount += 1;
      }
    }

    return sampleCount === 0 ? 0 : Math.sqrt(sum / sampleCount);
  });

  const maxPeak = Math.max(...peaks);
  if (maxPeak <= 0) {
    return Array.from({ length: barCount }, () => minimumVisiblePeak);
  }

  return peaks.map((peak) => Math.min(1, peak / maxPeak));
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const audioGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
}
