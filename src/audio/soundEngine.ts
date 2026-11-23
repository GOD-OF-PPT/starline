export type SfxKind =
  | 'click'
  | 'rotate'
  | 'place'
  | 'invalid'
  | 'energyLink'
  | 'laserFire'
  | 'chargeUp'
  | 'heavyBlast'
  | 'droneLaunch'
  | 'counterZap'
  | 'contractDeliver'
  | 'shieldHit'
  | 'hullHit'
  | 'enemyDestroy'
  | 'bossAlarm'
  | 'relicRestore'
  | 'repairPulse'
  | 'warpJump'
  | 'creditTick'
  | 'rewardRare'
  | 'buildComplete'
  | 'returnDock'
  | 'tacticalOrder'
  | 'bossPhase'
  | 'shieldOverload'
  | 'empDisrupt';

export type BgmTrack = 'base' | 'expedition' | 'boss' | 'none';

/**
 * Procedural Web Audio synthesizer delivering tactile mechanical sci-fi SFX and
 * two seamless ambient loops without heavy audio downloads.
 * Safely degrades if audio is blocked or unsupported.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private sfxMuted = false;
  private bgmMuted = false;
  private currentTrack: BgmTrack = 'none';
  private bgmTimer: number | null = null;
  private bgmStep = 0;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.currentTrack !== 'none' && !this.bgmMuted && this.bgmTimer === null) {
      this.startBgmLoop();
    }
  }

  setMute(sfxMuted: boolean, bgmMuted: boolean): void {
    this.sfxMuted = sfxMuted;
    this.bgmMuted = bgmMuted;
    if (this.bgmMuted) {
      this.stopBgmLoop();
    } else if (this.currentTrack !== 'none') {
      this.startBgmLoop();
    }
  }

  setTrack(track: BgmTrack): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    this.bgmStep = 0;
    this.stopBgmLoop();
    if (track !== 'none' && !this.bgmMuted) {
      this.startBgmLoop();
    }
  }

  getCurrentTrack(): BgmTrack {
    return this.currentTrack;
  }

  play(kind: SfxKind): void {
    if (this.sfxMuted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    try {
      switch (kind) {
        case 'click':
          this.tone(ctx, 'triangle', 540, 380, 0.04, 0.065, now);
          break;
        case 'rotate':
          this.tone(ctx, 'square', 640, 960, 0.045, 0.055, now);
          this.tone(ctx, 'triangle', 320, 440, 0.04, 0.05, now + 0.015);
          break;
        case 'place':
          // Satisfying magnetic bulkhead latch clunk
          this.tone(ctx, 'triangle', 200, 82, 0.095, 0.16, now);
          this.tone(ctx, 'sine', 920, 640, 0.055, 0.075, now + 0.02);
          break;
        case 'invalid':
          this.tone(ctx, 'sawtooth', 165, 105, 0.12, 0.09, now);
          break;
        case 'energyLink':
          this.tone(ctx, 'sine', 523, 880, 0.14, 0.1, now);
          this.tone(ctx, 'triangle', 784, 1175, 0.14, 0.08, now + 0.05);
          this.tone(ctx, 'sine', 1046, 1318, 0.16, 0.06, now + 0.1);
          break;
        case 'laserFire':
          this.tone(ctx, 'sawtooth', 940, 190, 0.13, 0.085, now);
          this.tone(ctx, 'sine', 1320, 440, 0.09, 0.05, now);
          break;
        case 'chargeUp':
          // Heavy cannon capacitor charge hum
          this.tone(ctx, 'sine', 190, 520, 0.24, 0.08, now);
          this.tone(ctx, 'triangle', 380, 760, 0.2, 0.05, now + 0.04);
          break;
        case 'heavyBlast':
          // Deep railgun punch + bass thump
          this.tone(ctx, 'sawtooth', 180, 44, 0.26, 0.16, now);
          this.noiseBurst(ctx, 0.18, 860, 0.13, now);
          this.tone(ctx, 'square', 420, 110, 0.14, 0.08, now);
          break;
        case 'droneLaunch':
          // Merged per-round micro-drone volley chirp
          this.tone(ctx, 'triangle', 680, 1120, 0.07, 0.07, now);
          this.tone(ctx, 'sine', 960, 1340, 0.07, 0.055, now + 0.055);
          break;
        case 'counterZap':
          // Crisp reactive shield-arc counter zap
          this.tone(ctx, 'sawtooth', 1240, 360, 0.11, 0.1, now);
          this.tone(ctx, 'triangle', 740, 1480, 0.09, 0.075, now + 0.025);
          break;
        case 'contractDeliver':
          // Clean industrial confirmation chime for contract delivery
          this.tone(ctx, 'triangle', 440, 440, 0.12, 0.085, now);
          this.tone(ctx, 'triangle', 554.37, 554.37, 0.12, 0.085, now + 0.1);
          this.tone(ctx, 'sine', 659.25, 880, 0.28, 0.1, now + 0.2);
          break;
        case 'shieldHit':
          this.tone(ctx, 'sine', 300, 140, 0.14, 0.12, now);
          this.tone(ctx, 'triangle', 560, 380, 0.11, 0.07, now);
          break;
        case 'hullHit':
          this.tone(ctx, 'sawtooth', 145, 52, 0.17, 0.14, now);
          this.noiseBurst(ctx, 0.12, 620, 0.09, now);
          break;
        case 'enemyDestroy':
          this.tone(ctx, 'sawtooth', 120, 34, 0.38, 0.16, now);
          this.noiseBurst(ctx, 0.34, 480, 0.14, now);
          this.tone(ctx, 'triangle', 523, 784, 0.16, 0.07, now + 0.18);
          break;
        case 'bossAlarm':
          // Deep ominous capital-ship horn sweep
          this.tone(ctx, 'sawtooth', 88, 62, 0.45, 0.13, now);
          this.tone(ctx, 'triangle', 131, 98, 0.42, 0.09, now + 0.08);
          this.tone(ctx, 'sawtooth', 82, 55, 0.48, 0.12, now + 0.28);
          break;
        case 'relicRestore':
          // Shimmering museum artifact restoration arpeggio
          this.tone(ctx, 'sine', 523.25, 523.25, 0.24, 0.08, now);
          this.tone(ctx, 'sine', 659.25, 659.25, 0.26, 0.08, now + 0.1);
          this.tone(ctx, 'triangle', 783.99, 783.99, 0.3, 0.09, now + 0.2);
          this.tone(ctx, 'sine', 1046.5, 1318.5, 0.45, 0.1, now + 0.32);
          break;
        case 'repairPulse':
          this.tone(ctx, 'sine', 440, 660, 0.14, 0.08, now);
          this.tone(ctx, 'sine', 660, 880, 0.16, 0.07, now + 0.08);
          break;
        case 'warpJump':
          this.tone(ctx, 'sine', 110, 420, 0.24, 0.09, now);
          this.noiseBurst(ctx, 0.22, 1100, 0.06, now);
          break;
        case 'creditTick':
          this.tone(ctx, 'triangle', 880, 1175, 0.055, 0.06, now);
          break;
        case 'rewardRare':
          this.tone(ctx, 'triangle', 440, 440, 0.1, 0.09, now);
          this.tone(ctx, 'triangle', 554, 554, 0.1, 0.09, now + 0.09);
          this.tone(ctx, 'sine', 659, 880, 0.24, 0.1, now + 0.18);
          break;
        case 'buildComplete':
          this.tone(ctx, 'sawtooth', 320, 420, 0.08, 0.06, now);
          this.tone(ctx, 'triangle', 392, 392, 0.14, 0.09, now + 0.1);
          this.tone(ctx, 'triangle', 494, 494, 0.14, 0.09, now + 0.22);
          this.tone(ctx, 'sine', 587, 784, 0.32, 0.11, now + 0.34);
          break;
        case 'returnDock':
          this.tone(ctx, 'sine', 180, 120, 0.22, 0.1, now);
          this.tone(ctx, 'triangle', 523, 659, 0.16, 0.08, now + 0.14);
          this.tone(ctx, 'sine', 784, 1046, 0.24, 0.085, now + 0.26);
          break;
        case 'tacticalOrder':
          // Crisp bridge command confirmation chirp
          this.tone(ctx, 'triangle', 660, 990, 0.11, 0.09, now);
          this.tone(ctx, 'sine', 990, 1320, 0.14, 0.075, now + 0.05);
          break;
        case 'bossPhase':
          // Deep dramatic boss phase-shift horn + rising core power sweep
          this.tone(ctx, 'sawtooth', 76, 52, 0.48, 0.14, now);
          this.noiseBurst(ctx, 0.22, 720, 0.11, now + 0.04);
          this.tone(ctx, 'triangle', 220, 580, 0.34, 0.095, now + 0.12);
          break;
        case 'shieldOverload':
          // Shimmering crystalline hex-barrier overload pulse
          this.tone(ctx, 'sine', 360, 720, 0.22, 0.095, now);
          this.tone(ctx, 'triangle', 720, 1080, 0.2, 0.07, now + 0.05);
          break;
        case 'empDisrupt':
          // Descending dissonant electromagnetic disruption buzz
          this.tone(ctx, 'sawtooth', 880, 140, 0.24, 0.1, now);
          this.noiseBurst(ctx, 0.18, 1280, 0.09, now + 0.02);
          break;
      }
    } catch {
      // Never allow audio failures to break gameplay
    }
  }

  private noiseBurst(
    ctx: AudioContext,
    duration: number,
    cutoffHz: number,
    peakGain: number,
    startTime: number
  ): void {
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, startTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(startTime);
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    duration: number,
    peakGain: number,
    startTime: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
    }
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private startBgmLoop(): void {
    if (typeof window === 'undefined') return;
    if (this.bgmTimer !== null) return;
    const baseNotes = [130.81, 164.81, 196.0, 146.83, 130.81, 196.0, 220.0, 164.81];
    const expNotes = [110.0, 110.0, 130.81, 146.83, 110.0, 164.81, 146.83, 130.81];
    const bossBass = [73.42, 73.42, 77.78, 73.42, 87.31, 73.42, 69.3, 65.41];
    const bossArp = [293.66, 311.13, 349.23, 415.3, 440.0, 349.23, 311.13, 277.18];

    const stepMs =
      this.currentTrack === 'base' ? 1400 : this.currentTrack === 'boss' ? 420 : 750;
    this.bgmTimer = window.setInterval(() => {
      if (this.bgmMuted || !this.ctx || this.ctx.state !== 'running') return;
      const stepIdx = this.bgmStep;
      this.bgmStep += 1;
      const now = this.ctx.currentTime;

      if (this.currentTrack === 'boss') {
        const bassFreq = bossBass[stepIdx % bossBass.length];
        const arpFreq = bossArp[stepIdx % bossArp.length];
        this.tone(this.ctx, 'sawtooth', bassFreq, bassFreq * 0.985, 0.34, 0.024, now);
        if (stepIdx % 4 === 0) {
          this.tone(this.ctx, 'sine', bassFreq * 0.5, bassFreq * 0.5, 0.38, 0.022, now);
        }
        this.tone(this.ctx, 'triangle', arpFreq, arpFreq, 0.22, 0.015, now + 0.16);
        return;
      }

      const notes = this.currentTrack === 'base' ? baseNotes : expNotes;
      const freq = notes[stepIdx % notes.length];
      const dur = this.currentTrack === 'base' ? 1.3 : 0.65;
      this.tone(
        this.ctx,
        this.currentTrack === 'base' ? 'sine' : 'triangle',
        freq,
        freq,
        dur,
        this.currentTrack === 'base' ? 0.024 : 0.028,
        now
      );
      if (this.currentTrack === 'base' && this.bgmStep % 2 === 0) {
        this.tone(this.ctx, 'sine', freq * 2, freq * 2, 0.9, 0.012, now + 0.15);
      }
    }, stepMs);
  }

  private stopBgmLoop(): void {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}

export const soundEngine = new SoundEngine();
