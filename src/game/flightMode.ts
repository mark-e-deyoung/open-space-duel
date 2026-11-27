/** Canonical, versionable match-flight choices. A gameplay model is selected per match, not per client. */
export const FLIGHT_MODES = ['arcade', 'inertial'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export type FlightModeAgreement =
  | { ok: true; mode: FlightMode }
  | {
      ok: false;
      reason: 'invalid-host-mode' | 'invalid-guest-ack' | 'mode-mismatch';
    };

/** Validate untrusted settings without string coercion or fallback to another flight model. */
export function isFlightMode(value: unknown): value is FlightMode {
  return value === 'arcade' || value === 'inertial';
}

/**
 * The guest must explicitly acknowledge the host's selected model. This is a
 * pure prerequisite for a versioned wire/ruleset handshake, not a substitute
 * for network, sim-version, or client-capability negotiation.
 */
export function agreeFlightMode(
  hostSelection: unknown,
  guestAcknowledgment: unknown,
): FlightModeAgreement {
  if (!isFlightMode(hostSelection)) {
    return { ok: false, reason: 'invalid-host-mode' };
  }
  if (!isFlightMode(guestAcknowledgment)) {
    return { ok: false, reason: 'invalid-guest-ack' };
  }
  if (hostSelection !== guestAcknowledgment) {
    return { ok: false, reason: 'mode-mismatch' };
  }
  return { ok: true, mode: hostSelection };
}
