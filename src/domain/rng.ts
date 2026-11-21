export interface RngCursor {
  readonly seed: number;
  readonly draws: number;
}

/**
 * Deterministic Mulberry32 PRNG with explicit draw counter for serialization and exact replay.
 */
export class SeededRng {
  private readonly seed: number;
  private state: number;
  private draws: number;

  constructor(seed: number, draws = 0) {
    this.seed = seed >>> 0;
    this.state = this.seed;
    this.draws = 0;
    for (let i = 0; i < draws; i++) {
      this.nextRaw();
    }
  }

  private nextRaw(): number {
    this.draws += 1;
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextFloat(): number {
    return this.nextRaw();
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error(`nextInt maxExclusive must be > 0, got ${maxExclusive}`);
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return items[this.nextInt(items.length)];
  }

  getCursor(): RngCursor {
    return { seed: this.seed, draws: this.draws };
  }

  static fromCursor(cursor: RngCursor): SeededRng {
    return new SeededRng(cursor.seed, cursor.draws);
  }
}

export function createRandomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] || 133742;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 || 133742;
}
