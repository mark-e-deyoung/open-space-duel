/**
 * World configuration — shared constants used by SPA and server-peer.
 *
 * These are the canonical defaults. The server-peer overrides them via
 * environment variables (e.g. OSD_MAX_INPUTS_PER_SEC).
 */

/** World dimensions (pixels). Matches game canvas size. */
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 900;

/** Fixed timestep (ticks per second). */
export const TICK_RATE = 60;

/** Maximum active entities before projectile culling. */
export const MAX_ENTITIES = 400;

/** Maximum particles before old particles are dropped. */
export const MAX_PARTICLES = 200;

/** Default heartbeat timeout (ms) before DISCONNECTED state. */
export const HEARTBEAT_TIMEOUT_MS = 3000;

/** Maximum network state entity count before dropping (anti-abuse). */
export const MAX_STATE_ENTITIES = 500;
