/**
 * State checksum generation for deterministic replay validation.
 *
 * Generates a simple hash from game state that can be compared
 * across runs to detect divergence.
 */

import type { GameState } from '../game/engine/state';
import { snapZero } from './numeric';

/**
 * Generate a lightweight checksum for a game state tick.
 * Used to compare state across runs for determinism verification.
 */
export function checksumState(state: GameState): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis

  // Hash tick
  hash = fnv1a(hash, state.tick);

  // Hash active entities (sorted by id for stable output)
  const active = state.entities.filter((e) => e.isActive);
  hash = fnv1a(hash, active.length);

  for (const e of active) {
    hash = fnv1a(hash, e.type.charCodeAt(0));
    hash = fnv1a(hash, quantizeForHash(e.position.x));
    hash = fnv1a(hash, quantizeForHash(e.position.y));
    hash = fnv1a(hash, quantizeForHash(e.velocity.x));
    hash = fnv1a(hash, quantizeForHash(e.velocity.y));
    hash = fnv1a(hash, quantizeForHash(e.rotation));
    hash = fnv1a(hash, Math.round(e.radius));
  }

  // Hash score and lives for each player
  const playerIds = Object.keys(state.score).sort();
  for (const pid of playerIds) {
    hash = fnv1a(hash, state.score[pid] ?? 0);
    hash = fnv1a(hash, state.lives[pid] ?? 0);
  }

  // Hash wave
  hash = fnv1a(hash, state.wave);

  // Hash prngState if present
  if (state.prngState !== undefined) {
    hash = fnv1a(hash, state.prngState);
  }

  return hash >>> 0; // unsigned 32-bit
}

/** Hash a single tick for golden test comparisons. */
export function checksumTick(state: GameState): string {
  const hash = checksumState(state);
  return `tick=${state.tick} hash=${hash.toString(16).padStart(8, '0')}`;
}

// ─── Internal ─────────────────────────────────────────────────────────────

function fnv1a(hash: number, value: number): number {
  // Quantize to avoid float noise
  return ((hash ^ value) * 16777619) >>> 0;
}

function quantizeForHash(v: number): number {
  // Snap tiny residuals, then convert to fixed-point integer for hashing
  return Math.round(snapZero(v) * 1000);
}
