import { isFlightMode, type FlightMode } from './flightMode';

/**
 * Pure, versioned match-ruleset identity carried by BOTH peers.
 * Deliberately not a credential, transport authentication or a substitute
 * for peer-v1 runtime schema validation. Session admission is separate.
 */
export interface FlightSessionDescriptor {
  schemaVersion: 1;
  matchId: string;
  appVersion: string;
  seed: number;
  flightMode: FlightMode;
}

export type FlightSessionAgreement =
  | { ok: true; session: FlightSessionDescriptor }
  | {
      ok: false;
      reason:
        | 'invalid-host-session'
        | 'invalid-guest-session'
        | 'match-id-mismatch'
        | 'app-version-mismatch'
        | 'seed-mismatch'
        | 'flight-mode-mismatch';
    };

const EXACT_FIELDS = [
  'schemaVersion',
  'matchId',
  'appVersion',
  'seed',
  'flightMode',
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** No coercion, defaulting or undocumented extension fields at this schema version. */
export function parseFlightSessionDescriptor(
  value: unknown,
): FlightSessionDescriptor | null {
  try {
    if (!isPlainRecord(value)) return null;
    const fields = Object.keys(value);
    if (fields.length !== EXACT_FIELDS.length) return null;
    if (EXACT_FIELDS.some((key) => !Object.hasOwn(value, key))) return null;
    if (value.schemaVersion !== 1) return null;
    if (
      typeof value.matchId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value.matchId)
    ) return null;
    if (
      typeof value.appVersion !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/.test(value.appVersion)
    ) return null;
    if (
      !Number.isSafeInteger(value.seed) ||
      (value.seed as number) < 0 ||
      (value.seed as number) > 0xffffffff
    ) return null;
    if (!isFlightMode(value.flightMode)) return null;

    return {
      schemaVersion: 1,
      matchId: value.matchId,
      appVersion: value.appVersion,
      seed: value.seed as number,
      flightMode: value.flightMode,
    };
  } catch {
    // Unexpected host object/proxy behavior is not an acceptable peer frame.
    return null;
  }
}

/** Host and guest must acknowledge the exact same deterministic ruleset. */
export function agreeFlightSession(
  host: unknown,
  guest: unknown,
): FlightSessionAgreement {
  const a = parseFlightSessionDescriptor(host);
  if (!a) return { ok: false, reason: 'invalid-host-session' };
  const b = parseFlightSessionDescriptor(guest);
  if (!b) return { ok: false, reason: 'invalid-guest-session' };
  if (a.matchId !== b.matchId) {
    return { ok: false, reason: 'match-id-mismatch' };
  }
  if (a.appVersion !== b.appVersion) {
    return { ok: false, reason: 'app-version-mismatch' };
  }
  if (a.seed !== b.seed) {
    return { ok: false, reason: 'seed-mismatch' };
  }
  if (a.flightMode !== b.flightMode) {
    return { ok: false, reason: 'flight-mode-mismatch' };
  }
  return { ok: true, session: a };
}
