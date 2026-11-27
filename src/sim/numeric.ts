// Standalone public numeric helpers for the deterministic simulation.
export const EPS = 1e-9;
export const WORLD_EPS = 1e-6;
export const POS_SCALE = 1000;
export const ANGLE_SCALE = 65536;

export function nearlyZero(value: number, tolerance = WORLD_EPS): boolean {
  return Math.abs(value) <= tolerance;
}
export function nearlyEqual(left: number, right: number, tolerance = WORLD_EPS): boolean {
  return Math.abs(left - right) <= tolerance;
}
export function snapZero(value: number, tolerance = WORLD_EPS): number {
  return nearlyZero(value, tolerance) ? 0 : value;
}
export const canonicalZero = snapZero;
export function isNegativeZero(value: number): boolean {
  return Object.is(value, -0);
}
export function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}
export function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error('[sim] ' + name + ' is not finite: ' + value);
}
export function quantizePosition(value: number): number {
  return Math.round(snapZero(value) * POS_SCALE);
}
export function dequantizePosition(value: number): number {
  return value / POS_SCALE;
}
export function quantizeVelocity(value: number): number {
  return Math.round(snapZero(value) * POS_SCALE);
}
export function dequantizeVelocity(value: number): number {
  return value / POS_SCALE;
}
export function quantizeAngle(radians: number): number {
  const tau = Math.PI * 2;
  let reduced = radians % tau;
  if (reduced < 0) reduced += tau;
  return Math.round((reduced / tau) * ANGLE_SCALE) % ANGLE_SCALE;
}
export function dequantizeAngle(value: number): number {
  return (value / ANGLE_SCALE) * Math.PI * 2;
}
