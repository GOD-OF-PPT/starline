export type SfxKind =
  | 'click'
  | 'rotate'
  | 'place'
  | 'invalid'
  | 'energyLink'
  | 'laserFire'
  | 'shieldHit'
  | 'hullHit'
  | 'rewardRare'
  | 'buildComplete'
  | 'returnDock';

export type BgmTrack = 'base' | 'expedition' | 'none';

/**
 * Procedural Web Audio synthesizer delivering all 10+ mechanical sci-fi SFX and
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

  play(kind: SfxKind): void {
    if (this.sfxMuted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    try {
      switch (kind) {
        case 'click':
          this.tone(ctx, 'triangle', 520, 360, 0.045, 0.07, now);
          break;
        case 'rotate':
          this.tone(ctx, 'square', 680, 920, 0.055, 0.06, now);
          break;
        case 'place':
          // Crisp metallic snap
          this.tone(ctx, 'triangle', 220, 95, 0.09, 0.14, now);
          this.tone(ctx, 'sine', 840, 620, 0.06, 0.08, now + 0.02);
          break;
        case 'invalid':
          this.tone(ctx, 'sawtooth', 165, 110, 0.12, 0.09, now);
          break;
        case 'energyLink':
          this.tone(ctx, 'sine', 520, 880, 0.14, 0.1, now);
          this.tone(ctx, 'triangle', 780, 1180, 0.12, 0.07, now + 0.05);
          break;
        case 'laserFire':
          this.tone(ctx, 'sawtooth', 880, 210, 0.13, 0.08, now);
          break;
        case 'shieldHit':
          this.tone(ctx, 'sine', 260, 120, 0.14, 0.12, now);
          this.tone(ctx, 'triangle', 480, 310, 0.1, 0.06, now);
          break;
        case 'hullHit':
          this.tone(ctx, 'sawtooth', 140, 58, 0.16, 0.13, now);
          break;
        case 'rewardRare':
          this.tone(ctx, 'triangle', 440, 440, 0.1, 0.09, now);
          this.tone(ctx, 'triangle', 554, 554, 0.1, 0.09, now + 0.09);
          this.tone(ctx, 'sine', 659, 880, 0.22, 0.1, now + 0.18);
          break;
        case 'buildComplete':
          this.tone(ctx, 'sawtooth', 320, 420, 0.08, 0.06, now);
          this.tone(ctx, 'triangle', 392, 392, 0.14, 0.09, now + 0.1);
          this.tone(ctx, 'triangle', 494, 494, 0.14, 0.09, now + 0.22);
          this.tone(ctx, 'sine', 587, 784, 0.3, 0.11, now + 0.34);
          break;
        case 'returnDock':
          this.tone(ctx, 'sine', 180, 130, 0.2, 0.1, now);
          this.tone(ctx, 'triangle', 523, 659, 0.16, 0.08, now + 0.14);
          this.tone(ctx, 'sine', 784, 784, 0.2, 0.08, now + 0.26);
          break;
      }
    } catch {
      // Never allow audio failures to break gameplay
    }
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

    const stepMs = this.currentTrack === 'base' ? 1400 : 750;
    this.bgmTimer = window.setInterval(() => {
      if (this.bgmMuted || !this.ctx || this.ctx.state !== 'running') return;
      const notes = this.currentTrack === 'base' ? baseNotes : expNotes;
      const freq = notes[this.bgmStep % notes.length];
      this.bgmStep += 1;
      const now = this.ctx.currentTime;
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
