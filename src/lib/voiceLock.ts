export interface EnrolledVoiceProfile {
  avgPitchHz: number;
  pitchStdHz: number;
  spectrumProfile: number[]; // 16-band normalized energy distribution
  sampleFrames: number;
  enrolledAt: number;
}

export interface VoiceLockConfig {
  enabled: boolean;
  strictness: 'normal' | 'strict';
  profile: EnrolledVoiceProfile | null;
}

const VOICE_LOCK_STORAGE_KEY = 'vapetrax_sheru_voice_lock';

export function getStoredVoiceLock(): VoiceLockConfig {
  try {
    const raw = localStorage.getItem(VOICE_LOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed.enabled),
        strictness: parsed.strictness === 'strict' ? 'strict' : 'normal',
        profile: parsed.profile || null,
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, strictness: 'normal', profile: null };
}

export function saveStoredVoiceLock(cfg: VoiceLockConfig): void {
  try {
    localStorage.setItem(VOICE_LOCK_STORAGE_KEY, JSON.stringify(cfg));
  } catch (err) {
    console.error('Failed to save voice lock config:', err);
  }
}

/**
 * Autocorrelation F0 pitch detector on time-domain PCM frame.
 * Returns null if frame is silent or unvoiced noise.
 */
function detectPitchHz(timeData: Float32Array, sampleRate: number): { pitchHz: number | null; rms: number } {
  let sumSq = 0;
  for (let i = 0; i < timeData.length; i++) {
    sumSq += timeData[i] * timeData[i];
  }
  const rms = Math.sqrt(sumSq / timeData.length);
  if (rms < 0.018) return { pitchHz: null, rms };

  const minLag = Math.floor(sampleRate / 340); // ~340 Hz max voice F0
  const maxLag = Math.floor(sampleRate / 70);  // ~70 Hz min voice F0
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag && lag < timeData.length / 2; lag++) {
    let corr = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < timeData.length - lag; i += 2) {
      const a = timeData[i];
      const b = timeData[i + lag];
      corr += a * b;
      norm1 += a * a;
      norm2 += b * b;
    }
    const denom = Math.sqrt(norm1 * norm2);
    const normalized = denom > 0 ? corr / denom : 0;
    if (normalized > bestCorr) {
      bestCorr = normalized;
      bestLag = lag;
    }
  }

  if (bestCorr < 0.45 || bestLag <= 0) {
    return { pitchHz: null, rms };
  }
  return { pitchHz: sampleRate / bestLag, rms };
}

/**
 * Extracts a 16-band normalized spectral distribution in the human speech range (~100Hz - 4000Hz).
 */
function extractSpectrumBands(freqBytes: Uint8Array, sampleRate: number, fftSize: number): number[] {
  const bands = 16;
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(100 / binHz));
  const maxBin = Math.min(freqBytes.length - 1, Math.ceil(4000 / binHz));
  const span = Math.max(1, maxBin - minBin);
  const perBand = Math.max(1, Math.floor(span / bands));

  const raw: number[] = [];
  let total = 0;
  for (let b = 0; b < bands; b++) {
    const start = minBin + b * perBand;
    const end = b === bands - 1 ? maxBin : Math.min(maxBin, start + perBand);
    let sum = 0;
    for (let k = start; k < end; k++) {
      sum += freqBytes[k];
    }
    const avg = sum / Math.max(1, end - start);
    raw.push(avg);
    total += avg;
  }

  return total > 0 ? raw.map((v) => v / total) : raw.map(() => 1 / bands);
}

export class VoiceFrameCollector {
  private pitches: number[] = [];
  private bandSums: number[] = new Array(16).fill(0);
  private spectralFrames = 0;

  pushFrame(analyser: AnalyserNode, sampleRate: number): number {
    const timeBuf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(timeBuf);
    const { pitchHz, rms } = detectPitchHz(timeBuf, sampleRate);

    if (rms >= 0.018) {
      const freqBuf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqBuf);
      const bands = extractSpectrumBands(freqBuf, sampleRate, analyser.fftSize);
      for (let i = 0; i < 16; i++) {
        this.bandSums[i] += bands[i];
      }
      this.spectralFrames++;
      if (pitchHz !== null) {
        this.pitches.push(pitchHz);
      }
    }

    // Normalized mic volume 0..100 for live waveform indicator
    return Math.min(100, Math.round(rms * 420));
  }

  getActiveFrameCount(): number {
    return this.spectralFrames;
  }

  buildProfile(): EnrolledVoiceProfile | null {
    if (this.spectralFrames < 8) return null;

    const spectrumProfile = this.bandSums.map((s) => s / this.spectralFrames);
    let avgPitchHz = 135;
    let pitchStdHz = 25;

    if (this.pitches.length >= 4) {
      avgPitchHz = this.pitches.reduce((a, b) => a + b, 0) / this.pitches.length;
      const variance =
        this.pitches.reduce((acc, p) => acc + Math.pow(p - avgPitchHz, 2), 0) / this.pitches.length;
      pitchStdHz = Math.max(12, Math.sqrt(variance));
    }

    return {
      avgPitchHz: Math.round(avgPitchHz),
      pitchStdHz: Math.round(pitchStdHz),
      spectrumProfile,
      sampleFrames: this.spectralFrames,
      enrolledAt: Date.now(),
    };
  }

  verifyAgainst(
    enrolled: EnrolledVoiceProfile,
    strictness: 'normal' | 'strict'
  ): { matched: boolean; confidencePct: number; reason?: string } {
    const candidate = this.buildProfile();
    if (!candidate) {
      // Not enough voiced frames captured (e.g. very short 1-word clip)
      return { matched: true, confidencePct: 100 };
    }

    // 1. Cosine similarity of 16-band vocal spectral timbre
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < 16; i++) {
      const a = enrolled.spectrumProfile[i] || 0;
      const b = candidate.spectrumProfile[i] || 0;
      dot += a * b;
      magA += a * a;
      magB += b * b;
    }
    const cosineSim = magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;

    // 2. Pitch proximity score (only compare strongly if both had clear F0 pitches)
    let pitchScore = 1;
    if (this.pitches.length >= 4) {
      const pitchDiff = Math.abs(candidate.avgPitchHz - enrolled.avgPitchHz);
      const tolerance = strictness === 'strict' ? Math.max(28, enrolled.pitchStdHz * 1.6) : Math.max(42, enrolled.pitchStdHz * 2.2);
      pitchScore = Math.max(0, 1 - pitchDiff / (tolerance * 2));
    }

    const combined = cosineSim * 0.58 + pitchScore * 0.42;
    const threshold = strictness === 'strict' ? 0.82 : 0.72;
    const confidencePct = Math.round(combined * 100);

    if (combined < threshold) {
      return {
        matched: false,
        confidencePct,
        reason: `Voice mismatch (${confidencePct}% match, pitch ${candidate.avgPitchHz}Hz vs enrolled ${enrolled.avgPitchHz}Hz).`,
      };
    }

    return { matched: true, confidencePct };
  }
}
