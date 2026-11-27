/**
 * Deterministic PRNG for simulation.
 *
 * Re-exports the Mulberry32 implementation from src/game/engine/rng.ts
 * and adds simulation-specific helpers.
 *
 * The PRNG state is a single 32-bit number. Store it as `prngState` on
 * GameState so ticks can be replayed deterministically from any point.
 */

export { DeterministicRNG } from '../game/engine/rng';

import { DeterministicRNG } from '../game/engine/rng';

/**
 * Create a PRNG from a numeric seed.
 * The seed is hashed through mulberry32 to produce the initial state.
 */
export function createRNG(seed: number): DeterministicRNG {
  return new DeterministicRNG(seed);
}

/**
 * Create a PRNG from a saved state (for resuming from a snapshot).
 */
export function createRNGFromState(prngState: number): DeterministicRNG {
  return new DeterministicRNG(prngState);
}
