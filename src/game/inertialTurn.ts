/**
 * Pure, deterministic inertial steering step. Does not alter translation, shields,
 * weapons, or rendering. The caller must own the shared match energy ledger.
 *
 * Angular velocity persists in the absence of paid torque; steeringDirection
 * reports only actual energy-funded torque, never passive rotation.
 */
export type TurnDirection = -1 | 0 | 1;

export interface InertialTurnState {
  rotation: number;
  angularVelocity: number;
  energy: number;
}

export interface InertialTurnConfig {
  /** Angular acceleration at full RCS command, radians/second squared. */
  angularAcceleration: number;
  /** Magnitude limit, radians/second. */
  maxAngularSpeed: number;
  /** Energy per second of full-rate RCS operation. */
  steeringCostPerSecond: number;
}

export type InertialTurnResult =
  | {
      ok: true;
      state: InertialTurnState;
      steeringDirection: TurnDirection;
      energySpent: number;
    }
  | {
      ok: false;
      reason: 'invalid-direction' | 'invalid-state' | 'invalid-config' | 'invalid-dt' | 'non-finite-result';
    };

export const MAX_INERTIAL_TICK_SECONDS = 0.25;

/**
 * Semi-implicit angular Euler integration, with zero free damping/braking.
 * Reject rather than coerce malformed input or simulation state.
 */
export function stepInertialTurn(
  state: InertialTurnState,
  direction: TurnDirection,
  dt: number,
  config: InertialTurnConfig,
): InertialTurnResult {
  if (direction !== -1 && direction !== 0 && direction !== 1) {
    return { ok: false, reason: 'invalid-direction' };
  }
  if (!Number.isFinite(dt) || dt < 0 || dt > MAX_INERTIAL_TICK_SECONDS) {
    return { ok: false, reason: 'invalid-dt' };
  }
  if (
    !state ||
    !Number.isFinite(state.rotation) ||
    !Number.isFinite(state.angularVelocity) ||
    !Number.isFinite(state.energy) ||
    state.energy < 0
  ) {
    return { ok: false, reason: 'invalid-state' };
  }
  if (
    !config ||
    !Number.isFinite(config.angularAcceleration) ||
    config.angularAcceleration <= 0 ||
    !Number.isFinite(config.maxAngularSpeed) ||
    config.maxAngularSpeed <= 0 ||
    !Number.isFinite(config.steeringCostPerSecond) ||
    config.steeringCostPerSecond <= 0
  ) {
    return { ok: false, reason: 'invalid-config' };
  }
  if (Math.abs(state.angularVelocity) > config.maxAngularSpeed) {
    return { ok: false, reason: 'invalid-state' };
  }

  let nextAngularVelocity = state.angularVelocity;
  let energySpent = 0;
  let steeringDirection: TurnDirection = 0;
  if (dt > 0 && direction !== 0 && state.energy > 0) {
    const requestedCost = config.steeringCostPerSecond * dt;
    const fundedFraction = Math.min(1, state.energy / requestedCost);
    const commandedDelta = direction * config.angularAcceleration * dt * fundedFraction;
    nextAngularVelocity = Math.max(
      -config.maxAngularSpeed,
      Math.min(config.maxAngularSpeed, state.angularVelocity + commandedDelta),
    );
    const appliedDelta = nextAngularVelocity - state.angularVelocity;
    if (appliedDelta !== 0) {
      // Never charge for acceleration clipped at the angular-speed limit.
      energySpent = Math.min(
        state.energy,
        (Math.abs(appliedDelta) * config.steeringCostPerSecond) /
          config.angularAcceleration,
      );
      steeringDirection = direction;
    }
  }
  const nextRotation = state.rotation + nextAngularVelocity * dt;
  const nextEnergy = Math.max(0, state.energy - energySpent);
  if (!Number.isFinite(nextRotation) || !Number.isFinite(nextEnergy) || !Number.isFinite(nextAngularVelocity)) {
    return { ok: false, reason: 'non-finite-result' };
  }
  return {
    ok: true,
    state: { rotation: nextRotation, angularVelocity: nextAngularVelocity, energy: nextEnergy },
    steeringDirection,
    energySpent,
  };
}
