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
  | 'empDisrupt'
  | 'pickup'
  | 'hoverValid'
  | 'placeHeavy'
  | 'wreckCut'
  | 'clampPop'
  | 'craneServo'
  | 'cashRegister'
  | 'enemyFire';

export const ALL_SFX_KINDS: readonly SfxKind[] = [
  'click',
  'rotate',
  'place',
  'invalid',
  'energyLink',
  'laserFire',
  'chargeUp',
  'heavyBlast',
  'droneLaunch',
  'counterZap',
  'contractDeliver',
  'shieldHit',
  'hullHit',
  'enemyDestroy',
  'bossAlarm',
  'relicRestore',
  'repairPulse',
  'warpJump',
  'creditTick',
  'rewardRare',
  'buildComplete',
  'returnDock',
  'tacticalOrder',
  'bossPhase',
  'shieldOverload',
  'empDisrupt',
  'pickup',
  'hoverValid',
  'placeHeavy',
  'wreckCut',
  'clampPop',
  'craneServo',
  'cashRegister',
  'enemyFire',
] as const;

export type BgmTrack = 'base' | 'expedition' | 'boss' | 'none';

export interface SoundEngineOptions {
  /** Optional deterministic RNG in [0, 1) used strictly for SFX pitch randomization */
  readonly randomFn?: () => number;
}

export interface AudioGraphSnapshot {
  readonly initialized: boolean;
  readonly state: AudioContextState | 'unavailable';
  readonly hasCompressor: boolean;
  readonly hasSfxBus: boolean;
  readonly hasBgmBus: boolean;
  readonly hasAmbientBus: boolean;
  readonly hasMasterGain: boolean;
  readonly ambientRunning: boolean;
  readonly ambientCutoffHz: number | null;
  readonly track: BgmTrack;
  readonly sfxMuted: boolean;
  readonly bgmMuted: boolean;
  readonly ambientMuted: boolean;
  readonly sfxBusGain: number;
  readonly bgmBusGain: number;
  readonly ambientBusGain: number;
  readonly masterGain: number;
}

interface AmbientProfile {
  readonly cutoffHz: number;
  readonly q: number;
  readonly gain: number;
}

const DEFAULT_MASTER_GAIN = 0.9;
const DEFAULT_SFX_BUS_GAIN = 0.85;
const DEFAULT_BGM_BUS_GAIN = 0.72;
const SFX_PITCH_JITTER_RATIO = 0.04; // ±4%, strictly inside ±3–5% contract

const AMBIENT_PROFILES: Record<Exclude<BgmTrack, 'none'>, AmbientProfile> = {
  base: { cutoffHz: 240, q: 1.2, gain: 0.042 },
  expedition: { cutoffHz: 380, q: 1.8, gain: 0.032 },
  boss: { cutoffHz: 150, q: 2.8, gain: 0.05 },
};

/**
 * Procedural Web Audio synthesizer delivering tactile mechanical sci-fi SFX,
 * filtered space/station ambient beds, and dynamic BGM routed through
 * independent buses and a mastering DynamicsCompressorNode without external audio files.
 * Safely degrades if audio is blocked, suspended, or unsupported.
 */
export class SoundEngine {
  private readonly randomFn: () => number;
  private ctx: AudioContext | null = null;
  private graphCtx: AudioContext | null = null;

  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;

  private ambientBuffer: AudioBuffer | null = null;
  private ambientBufferCtx: AudioContext | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientCutoffHz: number | null = null;

  private sfxMuted = false;
  private bgmMuted = false;
  private ambientMuted = false;
  private ambientMuteExplicit = false;

  private currentTrack: BgmTrack = 'none';
  private bgmTimer: number | null = null;
  private bgmStep = 0;

  private sfxBusTargetGain = DEFAULT_SFX_BUS_GAIN;
  private bgmBusTargetGain = DEFAULT_BGM_BUS_GAIN;
  private ambientBusTargetGain = 0;

  constructor(options?: SoundEngineOptions) {
    this.randomFn = options?.randomFn ?? Math.random;
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
      } catch {
        this.ctx = null;
        return;
      }
    }
    const ctx = this.ctx;
    if (!ctx) return;

    this.ensureGraph(ctx);
    this.syncBusGains();

    if (ctx.state === 'suspended') {
      try {
        const resumeResult = ctx.resume();
        if (resumeResult && typeof resumeResult.then === 'function') {
          resumeResult
            .then(() => {
              if (this.ctx !== ctx) return;
              this.ensureGraph(ctx);
              this.syncBusGains();
              this.syncAmbientBed();
              if (this.currentTrack !== 'none' && !this.bgmMuted && this.bgmTimer === null) {
                this.startBgmLoop();
              }
            })
            .catch(() => {});
        }
      } catch {
        // Ignore blocked resume until next user gesture
      }
    }

    if (this.currentTrack !== 'none' && !this.bgmMuted && this.bgmTimer === null) {
      this.startBgmLoop();
    }
    this.syncAmbientBed();
  }

  setMute(sfxMuted: boolean, bgmMuted: boolean, ambientMuted?: boolean): void {
    this.sfxMuted = sfxMuted;
    this.bgmMuted = bgmMuted;
    if (ambientMuted !== undefined) {
      this.ambientMuted = ambientMuted;
      this.ambientMuteExplicit = true;
    } else if (!this.ambientMuteExplicit) {
      this.ambientMuted = bgmMuted;
    }

    this.syncBusGains();

    if (this.bgmMuted) {
      this.stopBgmLoop();
    } else if (this.currentTrack !== 'none') {
      this.startBgmLoop();
    }
    this.syncAmbientBed();
  }

  setSfxMuted(muted: boolean): void {
    this.sfxMuted = muted;
    this.syncBusGains();
  }

  setBgmMuted(muted: boolean): void {
    this.bgmMuted = muted;
    if (!this.ambientMuteExplicit) {
      this.ambientMuted = muted;
    }
    this.syncBusGains();
    if (this.bgmMuted) {
      this.stopBgmLoop();
    } else if (this.currentTrack !== 'none') {
      this.startBgmLoop();
    }
    this.syncAmbientBed();
  }

  setAmbientMuted(muted: boolean): void {
    this.ambientMuted = muted;
    this.ambientMuteExplicit = true;
    this.syncBusGains();
    this.syncAmbientBed();
  }

  setMuted(muted: boolean): void {
    this.setMute(muted, muted, muted);
  }

  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  isBgmMuted(): boolean {
    return this.bgmMuted;
  }

  isAmbientMuted(): boolean {
    return this.ambientMuted;
  }

  isMuted(): boolean {
    return this.sfxMuted && this.bgmMuted && this.ambientMuted;
  }

  setTrack(track: BgmTrack): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    this.bgmStep = 0;
    this.stopBgmLoop();
    if (track !== 'none' && !this.bgmMuted) {
      this.startBgmLoop();
    }
    this.syncAmbientBed();
  }

  getCurrentTrack(): BgmTrack {
    return this.currentTrack;
  }

  getAudioGraphState(): AudioGraphSnapshot {
    const ctx = this.ctx;
    return {
      initialized: this.graphCtx !== null && this.graphCtx === ctx,
      state: ctx ? ctx.state : 'unavailable',
      hasCompressor: this.compressor !== null,
      hasSfxBus: this.sfxBus !== null,
      hasBgmBus: this.bgmBus !== null,
      hasAmbientBus: this.ambientBus !== null,
      hasMasterGain: this.masterGain !== null,
      ambientRunning: this.ambientSource !== null,
      ambientCutoffHz: this.ambientCutoffHz,
      track: this.currentTrack,
      sfxMuted: this.sfxMuted,
      bgmMuted: this.bgmMuted,
      ambientMuted: this.ambientMuted,
      sfxBusGain: this.sfxBusTargetGain,
      bgmBusGain: this.bgmBusTargetGain,
      ambientBusGain: this.ambientBusTargetGain,
      masterGain: this.masterGain ? DEFAULT_MASTER_GAIN : 0,
    };
  }

  dispose(): void {
    this.stopBgmLoop();
    this.stopAmbientSource();
    this.ambientFilter = null;
    this.ambientBuffer = null;
    this.ambientBufferCtx = null;
    this.ambientCutoffHz = null;
    this.sfxBus = null;
    this.bgmBus = null;
    this.ambientBus = null;
    this.compressor = null;
    this.masterGain = null;
    this.graphCtx = null;
    this.ctx = null;
    this.currentTrack = 'none';
    this.bgmStep = 0;
    this.sfxMuted = false;
    this.bgmMuted = false;
    this.ambientMuted = false;
    this.ambientMuteExplicit = false;
    this.sfxBusTargetGain = DEFAULT_SFX_BUS_GAIN;
    this.bgmBusTargetGain = DEFAULT_BGM_BUS_GAIN;
    this.ambientBusTargetGain = 0;
  }

  play(kind: SfxKind): void {
    if (this.sfxMuted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.ensureGraph(ctx);
    const dest = this.sfxBus;
    if (!dest) return;

    const now = ctx.currentTime;
    const pitch = this.nextSfxPitchFactor();

    try {
      switch (kind) {
        case 'click':
          this.tone(ctx, dest, 'triangle', 540 * pitch, 380 * pitch, 0.04, 0.065, now);
          break;
        case 'rotate':
          this.tone(ctx, dest, 'square', 640 * pitch, 960 * pitch, 0.045, 0.055, now);
          this.tone(ctx, dest, 'triangle', 320 * pitch, 440 * pitch, 0.04, 0.05, now + 0.015);
          break;
        case 'place':
          // Satisfying magnetic bulkhead latch clunk
          this.tone(ctx, dest, 'triangle', 200 * pitch, 82 * pitch, 0.095, 0.16, now);
          this.tone(ctx, dest, 'sine', 920 * pitch, 640 * pitch, 0.055, 0.075, now + 0.02);
          break;
        case 'invalid':
          this.tone(ctx, dest, 'sawtooth', 165 * pitch, 105 * pitch, 0.12, 0.09, now);
          break;
        case 'energyLink':
          this.tone(ctx, dest, 'sine', 523 * pitch, 880 * pitch, 0.14, 0.1, now);
          this.tone(ctx, dest, 'triangle', 784 * pitch, 1175 * pitch, 0.14, 0.08, now + 0.05);
          this.tone(ctx, dest, 'sine', 1046 * pitch, 1318 * pitch, 0.16, 0.06, now + 0.1);
          break;
        case 'laserFire':
          this.tone(ctx, dest, 'sawtooth', 940 * pitch, 190 * pitch, 0.13, 0.085, now);
          this.tone(ctx, dest, 'sine', 1320 * pitch, 440 * pitch, 0.09, 0.05, now);
          break;
        case 'chargeUp':
          // Heavy cannon capacitor charge hum
          this.tone(ctx, dest, 'sine', 190 * pitch, 520 * pitch, 0.24, 0.08, now);
          this.tone(ctx, dest, 'triangle', 380 * pitch, 760 * pitch, 0.2, 0.05, now + 0.04);
          break;
        case 'heavyBlast':
          // Deep railgun punch + bass thump
          this.tone(ctx, dest, 'sawtooth', 180 * pitch, 44 * pitch, 0.26, 0.16, now);
          this.noiseBurst(ctx, dest, 0.18, 860 * pitch, 0.13, now);
          this.tone(ctx, dest, 'square', 420 * pitch, 110 * pitch, 0.14, 0.08, now);
          break;
        case 'droneLaunch':
          // Merged per-round micro-drone volley chirp
          this.tone(ctx, dest, 'triangle', 680 * pitch, 1120 * pitch, 0.07, 0.07, now);
          this.tone(ctx, dest, 'sine', 960 * pitch, 1340 * pitch, 0.07, 0.055, now + 0.055);
          break;
        case 'counterZap':
          // Crisp reactive shield-arc counter zap
          this.tone(ctx, dest, 'sawtooth', 1240 * pitch, 360 * pitch, 0.11, 0.1, now);
          this.tone(ctx, dest, 'triangle', 740 * pitch, 1480 * pitch, 0.09, 0.075, now + 0.025);
          break;
        case 'contractDeliver':
          // Clean industrial confirmation chime for contract delivery
          this.tone(ctx, dest, 'triangle', 440 * pitch, 440 * pitch, 0.12, 0.085, now);
          this.tone(ctx, dest, 'triangle', 554.37 * pitch, 554.37 * pitch, 0.12, 0.085, now + 0.1);
          this.tone(ctx, dest, 'sine', 659.25 * pitch, 880 * pitch, 0.28, 0.1, now + 0.2);
          break;
        case 'shieldHit':
          this.tone(ctx, dest, 'sine', 300 * pitch, 140 * pitch, 0.14, 0.12, now);
          this.tone(ctx, dest, 'triangle', 560 * pitch, 380 * pitch, 0.11, 0.07, now);
          break;
        case 'hullHit':
          this.tone(ctx, dest, 'sawtooth', 145 * pitch, 52 * pitch, 0.17, 0.14, now);
          this.noiseBurst(ctx, dest, 0.12, 620 * pitch, 0.09, now);
          break;
        case 'enemyDestroy':
          this.tone(ctx, dest, 'sawtooth', 120 * pitch, 34 * pitch, 0.38, 0.16, now);
          this.noiseBurst(ctx, dest, 0.34, 480 * pitch, 0.14, now);
          this.tone(ctx, dest, 'triangle', 523 * pitch, 784 * pitch, 0.16, 0.07, now + 0.18);
          break;
        case 'bossAlarm':
          // Deep ominous capital-ship horn sweep
          this.tone(ctx, dest, 'sawtooth', 88 * pitch, 62 * pitch, 0.45, 0.13, now);
          this.tone(ctx, dest, 'triangle', 131 * pitch, 98 * pitch, 0.42, 0.09, now + 0.08);
          this.tone(ctx, dest, 'sawtooth', 82 * pitch, 55 * pitch, 0.48, 0.12, now + 0.28);
          break;
        case 'relicRestore':
          // Shimmering museum artifact restoration arpeggio
          this.tone(ctx, dest, 'sine', 523.25 * pitch, 523.25 * pitch, 0.24, 0.08, now);
          this.tone(ctx, dest, 'sine', 659.25 * pitch, 659.25 * pitch, 0.26, 0.08, now + 0.1);
          this.tone(ctx, dest, 'triangle', 783.99 * pitch, 783.99 * pitch, 0.3, 0.09, now + 0.2);
          this.tone(ctx, dest, 'sine', 1046.5 * pitch, 1318.5 * pitch, 0.45, 0.1, now + 0.32);
          break;
        case 'repairPulse':
          this.tone(ctx, dest, 'sine', 440 * pitch, 660 * pitch, 0.14, 0.08, now);
          this.tone(ctx, dest, 'sine', 660 * pitch, 880 * pitch, 0.16, 0.07, now + 0.08);
          break;
        case 'warpJump':
          this.tone(ctx, dest, 'sine', 110 * pitch, 420 * pitch, 0.24, 0.09, now);
          this.noiseBurst(ctx, dest, 0.22, 1100 * pitch, 0.06, now);
          break;
        case 'creditTick':
          this.tone(ctx, dest, 'triangle', 880 * pitch, 1175 * pitch, 0.055, 0.06, now);
          break;
        case 'rewardRare':
          this.tone(ctx, dest, 'triangle', 440 * pitch, 440 * pitch, 0.1, 0.09, now);
          this.tone(ctx, dest, 'triangle', 554 * pitch, 554 * pitch, 0.1, 0.09, now + 0.09);
          this.tone(ctx, dest, 'sine', 659 * pitch, 880 * pitch, 0.24, 0.1, now + 0.18);
          break;
        case 'buildComplete':
          this.tone(ctx, dest, 'sawtooth', 320 * pitch, 420 * pitch, 0.08, 0.06, now);
          this.tone(ctx, dest, 'triangle', 392 * pitch, 392 * pitch, 0.14, 0.09, now + 0.1);
          this.tone(ctx, dest, 'triangle', 494 * pitch, 494 * pitch, 0.14, 0.09, now + 0.22);
          this.tone(ctx, dest, 'sine', 587 * pitch, 784 * pitch, 0.32, 0.11, now + 0.34);
          break;
        case 'returnDock':
          this.tone(ctx, dest, 'sine', 180 * pitch, 120 * pitch, 0.22, 0.1, now);
          this.tone(ctx, dest, 'triangle', 523 * pitch, 659 * pitch, 0.16, 0.08, now + 0.14);
          this.tone(ctx, dest, 'sine', 784 * pitch, 1046 * pitch, 0.24, 0.085, now + 0.26);
          break;
        case 'tacticalOrder':
          // Crisp bridge command confirmation chirp
          this.tone(ctx, dest, 'triangle', 660 * pitch, 990 * pitch, 0.11, 0.09, now);
          this.tone(ctx, dest, 'sine', 990 * pitch, 1320 * pitch, 0.14, 0.075, now + 0.05);
          break;
        case 'bossPhase':
          // Deep dramatic boss phase-shift horn + rising core power sweep
          this.tone(ctx, dest, 'sawtooth', 76 * pitch, 52 * pitch, 0.48, 0.14, now);
          this.noiseBurst(ctx, dest, 0.22, 720 * pitch, 0.11, now + 0.04);
          this.tone(ctx, dest, 'triangle', 220 * pitch, 580 * pitch, 0.34, 0.095, now + 0.12);
          break;
        case 'shieldOverload':
          // Shimmering crystalline hex-barrier overload pulse
          this.tone(ctx, dest, 'sine', 360 * pitch, 720 * pitch, 0.22, 0.095, now);
          this.tone(ctx, dest, 'triangle', 720 * pitch, 1080 * pitch, 0.2, 0.07, now + 0.05);
          break;
        case 'empDisrupt':
          // Descending dissonant electromagnetic disruption buzz
          this.tone(ctx, dest, 'sawtooth', 880 * pitch, 140 * pitch, 0.24, 0.1, now);
          this.noiseBurst(ctx, dest, 0.18, 1280 * pitch, 0.09, now + 0.02);
          break;
        case 'pickup':
          // Crisp magnetic unlatch + upward servo chirp
          this.tone(ctx, dest, 'triangle', 310 * pitch, 520 * pitch, 0.045, 0.075, now);
          this.tone(ctx, dest, 'sine', 1180 * pitch, 1480 * pitch, 0.03, 0.04, now + 0.015);
          break;
        case 'hoverValid':
          // Soft tactile detent tick on valid bay cell
          this.tone(ctx, dest, 'sine', 1420 * pitch, 1680 * pitch, 0.022, 0.032, now);
          break;
        case 'placeHeavy':
          // Weighted hydraulic thud + bulkhead bolt lock for large items
          this.tone(ctx, dest, 'sine', 135 * pitch, 46 * pitch, 0.16, 0.2, now);
          this.noiseBurst(ctx, dest, 0.09, 420 * pitch, 0.11, now);
          this.tone(ctx, dest, 'triangle', 480 * pitch, 240 * pitch, 0.07, 0.09, now + 0.03);
          this.tone(ctx, dest, 'sine', 840 * pitch, 620 * pitch, 0.045, 0.05, now + 0.055);
          break;
        case 'wreckCut':
          // Sizzling plasma torch cutting bulkhead steel
          this.noiseBurst(ctx, dest, 0.34, 2400 * pitch, 0.12, now, 'bandpass', 2.2);
          this.tone(ctx, dest, 'sawtooth', 260 * pitch, 410 * pitch, 0.28, 0.075, now);
          this.tone(ctx, dest, 'square', 1120 * pitch, 680 * pitch, 0.18, 0.045, now + 0.08);
          break;
        case 'clampPop':
          // Spring clamp snap + pressurized air hiss
          this.tone(ctx, dest, 'triangle', 180 * pitch, 640 * pitch, 0.06, 0.13, now);
          this.tone(ctx, dest, 'sine', 760 * pitch, 290 * pitch, 0.08, 0.09, now + 0.025);
          this.noiseBurst(ctx, dest, 0.14, 1900 * pitch, 0.085, now + 0.02, 'lowpass');
          break;
        case 'craneServo':
          // Articulated electric crane servo slew + hydraulic brake detent
          this.tone(ctx, dest, 'sawtooth', 110 * pitch, 230 * pitch, 0.26, 0.065, now);
          this.tone(ctx, dest, 'triangle', 220 * pitch, 185 * pitch, 0.22, 0.055, now + 0.22);
          this.noiseBurst(ctx, dest, 0.12, 680 * pitch, 0.045, now + 0.04, 'lowpass');
          this.tone(ctx, dest, 'square', 520 * pitch, 340 * pitch, 0.04, 0.05, now + 0.4);
          break;
        case 'cashRegister':
          // Mechanical ledger drawer snap + G6 -> C7 metallic bell
          this.noiseBurst(ctx, dest, 0.035, 2600 * pitch, 0.06, now, 'highpass');
          this.tone(ctx, dest, 'sine', 1567.98 * pitch, 1567.98 * pitch, 0.18, 0.095, now + 0.03);
          this.tone(ctx, dest, 'sine', 2093.0 * pitch, 2093.0 * pitch, 0.34, 0.105, now + 0.095);
          this.tone(ctx, dest, 'triangle', 3135.96 * pitch, 3135.96 * pitch, 0.22, 0.04, now + 0.095);
          break;
        case 'enemyFire':
          // Gritty hostile plasma volley (distinct lower timbre from player laserFire)
          this.tone(ctx, dest, 'sawtooth', 520 * pitch, 115 * pitch, 0.15, 0.095, now);
          this.tone(ctx, dest, 'square', 340 * pitch, 92 * pitch, 0.12, 0.065, now + 0.015);
          this.noiseBurst(ctx, dest, 0.07, 1100 * pitch, 0.06, now, 'lowpass');
          break;
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    } catch {
      // Never allow audio failures to break gameplay
    }
  }

  private ensureGraph(ctx: AudioContext): void {
    if (this.graphCtx === ctx && this.masterGain && this.sfxBus && this.bgmBus && this.ambientBus) {
      return;
    }
    this.stopAmbientSource();
    this.ambientFilter = null;
    this.ambientCutoffHz = null;

    try {
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      const sfxBus = ctx.createGain();
      const bgmBus = ctx.createGain();
      const ambientBus = ctx.createGain();

      masterGain.gain.setValueAtTime(DEFAULT_MASTER_GAIN, now);
      this.sfxBusTargetGain = this.sfxMuted ? 0 : DEFAULT_SFX_BUS_GAIN;
      this.bgmBusTargetGain = this.bgmMuted ? 0 : DEFAULT_BGM_BUS_GAIN;
      this.ambientBusTargetGain = 0;

      sfxBus.gain.setValueAtTime(this.sfxBusTargetGain, now);
      bgmBus.gain.setValueAtTime(this.bgmBusTargetGain, now);
      ambientBus.gain.setValueAtTime(0, now);

      let compressor: DynamicsCompressorNode | null = null;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        try {
          compressor = ctx.createDynamicsCompressor();
          compressor.threshold.setValueAtTime(-16, now);
          compressor.knee.setValueAtTime(18, now);
          compressor.ratio.setValueAtTime(6, now);
          compressor.attack.setValueAtTime(0.005, now);
          compressor.release.setValueAtTime(0.18, now);
        } catch {
          compressor = null;
        }
      }

      if (compressor) {
        sfxBus.connect(compressor);
        bgmBus.connect(compressor);
        ambientBus.connect(compressor);
        compressor.connect(masterGain);
      } else {
        sfxBus.connect(masterGain);
        bgmBus.connect(masterGain);
        ambientBus.connect(masterGain);
      }
      masterGain.connect(ctx.destination);

      this.masterGain = masterGain;
      this.compressor = compressor;
      this.sfxBus = sfxBus;
      this.bgmBus = bgmBus;
      this.ambientBus = ambientBus;
      this.graphCtx = ctx;
    } catch {
      this.masterGain = null;
      this.compressor = null;
      this.sfxBus = null;
      this.bgmBus = null;
      this.ambientBus = null;
      this.graphCtx = null;
    }
  }

  private setParamSmooth(param: AudioParam, value: number, now: number, tauSec: number): void {
    param.cancelScheduledValues?.(now);
    if (tauSec > 0 && typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(value, now, tauSec);
    } else {
      param.setValueAtTime(value, now);
    }
  }

  private syncBusGains(): void {
    this.sfxBusTargetGain = this.sfxMuted ? 0 : DEFAULT_SFX_BUS_GAIN;
    this.bgmBusTargetGain = this.bgmMuted ? 0 : DEFAULT_BGM_BUS_GAIN;

    const ctx = this.ctx;
    if (!ctx || this.graphCtx !== ctx) return;
    const now = ctx.currentTime;

    if (this.sfxBus) {
      this.setParamSmooth(this.sfxBus.gain, this.sfxBusTargetGain, now, 0.015);
    }
    if (this.bgmBus) {
      this.setParamSmooth(this.bgmBus.gain, this.bgmBusTargetGain, now, 0.035);
    }
  }

  private ensureAmbientBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.ambientBuffer && this.ambientBufferCtx === ctx) {
      return this.ambientBuffer;
    }
    try {
      const sampleRate = Math.max(8000, ctx.sampleRate || 44100);
      const length = Math.max(1024, Math.floor(sampleRate * 2.0));
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      // Warm brown/pink-tilted industrial hull noise (leaky integrator, normalized)
      let last = 0;
      let peak = 0.0001;
      let seed = 0x51a71b3d;
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const white = (seed / 0xffffffff) * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last;
        const abs = Math.abs(last);
        if (abs > peak) peak = abs;
      }
      const norm = 0.8 / peak;
      for (let i = 0; i < length; i++) {
        data[i] *= norm;
      }
      this.ambientBuffer = buffer;
      this.ambientBufferCtx = ctx;
      return buffer;
    } catch {
      return null;
    }
  }

  private stopAmbientSource(): void {
    if (this.ambientSource) {
      try {
        this.ambientSource.stop();
      } catch {
        // Already stopped
      }
      try {
        this.ambientSource.disconnect();
      } catch {
        // Ignore disconnect error
      }
      this.ambientSource = null;
    }
  }

  private syncAmbientBed(): void {
    const ctx = this.ctx;
    const shouldPlay =
      this.currentTrack !== 'none' &&
      !this.ambientMuted &&
      ctx !== null &&
      ctx.state === 'running';

    if (!shouldPlay) {
      this.ambientBusTargetGain = 0;
      this.ambientCutoffHz = null;
      if (ctx && this.ambientBus && this.graphCtx === ctx) {
        this.setParamSmooth(this.ambientBus.gain, 0, ctx.currentTime, 0.05);
      }
      this.stopAmbientSource();
      return;
    }

    this.ensureGraph(ctx);
    if (!this.ambientBus) return;

    const track = this.currentTrack as Exclude<BgmTrack, 'none'>;
    const profile = AMBIENT_PROFILES[track];
    const now = ctx.currentTime;

    try {
      if (!this.ambientFilter) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(profile.cutoffHz, now);
        filter.Q.setValueAtTime(profile.q, now);
        filter.connect(this.ambientBus);
        this.ambientFilter = filter;
      } else {
        this.setParamSmooth(this.ambientFilter.frequency, profile.cutoffHz, now, 0.14);
        this.setParamSmooth(this.ambientFilter.Q, profile.q, now, 0.14);
      }

      if (!this.ambientSource) {
        const buffer = this.ensureAmbientBuffer(ctx);
        if (!buffer) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(this.ambientFilter);
        src.start(now);
        this.ambientSource = src;
      }

      this.ambientCutoffHz = profile.cutoffHz;
      this.ambientBusTargetGain = profile.gain;
      this.setParamSmooth(this.ambientBus.gain, profile.gain, now, 0.18);
    } catch {
      this.stopAmbientSource();
    }
  }

  private nextSfxPitchFactor(): number {
    const raw = this.randomFn();
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    return 1 + (clamped * 2 - 1) * SFX_PITCH_JITTER_RATIO;
  }

  private noiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    duration: number,
    cutoffHz: number,
    peakGain: number,
    startTime: number,
    filterType: BiquadFilterType = 'lowpass',
    q = 1
  ): void {
    const sampleCount = Math.max(1, Math.floor((ctx.sampleRate || 44100) * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate || 44100);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, cutoffHz), startTime);
    if (q !== 1) {
      filter.Q.setValueAtTime(q, startTime);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(startTime);
  }

  private tone(
    ctx: AudioContext,
    dest: AudioNode,
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
    const safeStart = Math.max(20, freqStart);
    const safeEnd = Math.max(20, freqEnd);
    osc.frequency.setValueAtTime(safeStart, startTime);
    if (safeEnd !== safeStart) {
      osc.frequency.exponentialRampToValueAtTime(safeEnd, startTime + duration);
    }
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(dest);
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
      this.ensureGraph(this.ctx);
      const dest = this.bgmBus;
      if (!dest) return;

      const stepIdx = this.bgmStep;
      this.bgmStep += 1;
      const now = this.ctx.currentTime;

      // BGM notes stay strictly unrandomized (pitch = 1.0) so harmony never drifts
      if (this.currentTrack === 'boss') {
        const bassFreq = bossBass[stepIdx % bossBass.length];
        const arpFreq = bossArp[stepIdx % bossArp.length];
        this.tone(this.ctx, dest, 'sawtooth', bassFreq, bassFreq * 0.985, 0.34, 0.024, now);
        if (stepIdx % 4 === 0) {
          this.tone(this.ctx, dest, 'sine', bassFreq * 0.5, bassFreq * 0.5, 0.38, 0.022, now);
        }
        this.tone(this.ctx, dest, 'triangle', arpFreq, arpFreq, 0.22, 0.015, now + 0.16);
        return;
      }

      const notes = this.currentTrack === 'base' ? baseNotes : expNotes;
      const freq = notes[stepIdx % notes.length];
      const dur = this.currentTrack === 'base' ? 1.3 : 0.65;
      this.tone(
        this.ctx,
        dest,
        this.currentTrack === 'base' ? 'sine' : 'triangle',
        freq,
        freq,
        dur,
        this.currentTrack === 'base' ? 0.024 : 0.028,
        now
      );
      if (this.currentTrack === 'base' && this.bgmStep % 2 === 0) {
        this.tone(this.ctx, dest, 'sine', freq * 2, freq * 2, 0.9, 0.012, now + 0.15);
      }
    }, stepMs);
  }

  private stopBgmLoop(): void {
    if (this.bgmTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    } else if (this.bgmTimer !== null) {
      this.bgmTimer = null;
    }
  }
}

export const soundEngine = new SoundEngine();
