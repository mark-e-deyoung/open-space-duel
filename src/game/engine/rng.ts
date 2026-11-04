/**
 * A simple deterministic random number generator using Mulberry32.
 */
export class DeterministicRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Current PRNG state — save this for determinism across ticks. */
  public get currentState(): number {
    return this.state;
  }

  // Returns a pseudo-random float between 0 (inclusive) and 1 (exclusive)
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Helper: return float in range [min, max)
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Helper: return integer in range [min, max]
  public rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}
