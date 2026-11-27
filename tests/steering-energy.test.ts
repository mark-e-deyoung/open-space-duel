import { describe, expect, it } from 'vitest';
import { createInitialState, ShipClass, type PlayerInput, type GameState } from '../src/game/engine/state';
import { createShip, SHIP_CONFIGS } from '../src/game/entities/ship';
import { updatePhysics } from '../src/game/systems/physics';
import { CanvasRenderer } from '../src/game/render/canvas';

const frame = (changes: Partial<PlayerInput> = {}): PlayerInput => ({
  thrust: false, left: false, right: false, fire: false,
  fireSecondary: false, shield: false, ...changes,
});

function fixture(shipClass: ShipClass = ShipClass.Standard) {
  const state = createInitialState(800, 600, 713);
  state.settings.boostersEnabled = false;
  const ship = createShip(400, 300, 'p1', shipClass);
  ship.invulnerabilityTimer = 0;
  ship.stats!.rechargeRate = 0; // Expose exact debits without idle recharge.
  state.entities = [ship];
  return { state, ship, step: (input: PlayerInput, dt = 0.1) =>
    updatePhysics(state, { p1: input }, dt) };
}

describe('commanded attitude thrusters', () => {
  for (const cls of [ShipClass.Standard, ShipClass.Interceptor, ShipClass.Dreadnought]) {
    it('charges left and right steering for ' + cls, () => {
      const a = fixture(cls);
      const initialAngle = a.ship.rotation;
      const energy = a.ship.energy!;
      a.step(frame({ left: true }));
      expect(a.ship.rotation).toBeCloseTo(initialAngle - a.ship.stats!.rotationSpeed * 0.1, 6);
      expect(a.ship.energy).toBeCloseTo(energy - SHIP_CONFIGS[cls].steeringCost * 0.1, 6);
      expect(a.ship.steeringDirection).toBe(-1);
      expect(a.ship.isThrusting).toBe(false);
      a.step(frame({ right: true }));
      expect(a.ship.rotation).toBeCloseTo(initialAngle, 6);
      expect(a.ship.steeringDirection).toBe(1);
      expect(a.ship.energy).toBeCloseTo(energy - SHIP_CONFIGS[cls].steeringCost * 0.2, 6);
    });
  }

  it('cancels opposite steering commands without wasting energy', () => {
    const a = fixture();
    const heading = a.ship.rotation;
    a.step(frame({ left: true, right: true }));
    expect(a.ship.rotation).toBe(heading);
    expect(a.ship.energy).toBe(a.ship.maxEnergy);
    expect(a.ship.steeringDirection).toBe(0);
  });

  it('charges pointing to a target only for the angle actually traversed', () => {
    const a = fixture();
    const initial = a.ship.rotation;
    a.step(frame({ targetRotation: initial + 0.02 }));
    expect(a.ship.rotation).toBeCloseTo(initial + 0.02, 6);
    expect(a.ship.energy).toBeCloseTo(
      a.ship.maxEnergy! - a.ship.stats!.steeringCost * 0.02 / a.ship.stats!.rotationSpeed, 6);
    expect(a.ship.steeringDirection).toBe(1);
    a.step(frame({ targetRotation: a.ship.rotation }));
    expect(a.ship.steeringDirection).toBe(0);
  });

  it('adds steering and forward burn costs from the same capacitor', () => {
    const a = fixture();
    const initial = a.ship.energy!;
    a.step(frame({ right: true, thrust: true }));
    expect(a.ship.steeringDirection).toBe(1);
    expect(a.ship.isThrusting).toBe(true);
    expect(Math.hypot(a.ship.velocity.x, a.ship.velocity.y)).toBeGreaterThan(0);
    expect(a.ship.energy).toBeCloseTo(
      initial - (a.ship.stats!.steeringCost + a.ship.stats!.thrustCost) * 0.1, 6);
  });

  it('scales underfunded turning and never grants free translation', () => {
    const a = fixture();
    const heading = a.ship.rotation;
    a.ship.energy = 0.5;
    a.step(frame({ right: true, thrust: true }));
    const expectedTurn = a.ship.stats!.rotationSpeed * (0.5 / a.ship.stats!.steeringCost);
    expect(a.ship.rotation).toBeCloseTo(heading + expectedTurn, 6);
    expect(a.ship.energy).toBeCloseTo(0, 6);
    expect(a.ship.isThrusting).toBe(false);
    expect(a.ship.steeringDirection).toBe(1);
    expect(Math.hypot(a.ship.velocity.x, a.ship.velocity.y)).toBeCloseTo(0, 6);
    a.step(frame({ right: true, thrust: true }));
    expect(a.ship.rotation).toBeCloseTo(heading + expectedTurn, 6);
    expect(a.ship.isThrusting).toBe(false);
    expect(a.ship.steeringDirection).toBe(0);
  });

  it('coasts under external momentum without firing command jets', () => {
    const a = fixture();
    a.ship.velocity.x = 110;
    const heading = a.ship.rotation;
    a.step(frame());
    expect(a.ship.velocity.x).toBeGreaterThan(0);
    expect(a.ship.rotation).toBe(heading);
    expect(a.ship.steeringDirection).toBe(0);
    expect(a.ship.isThrusting).toBe(false);
    expect(a.ship.energy).toBe(a.ship.maxEnergy);
  });

  it('preserves paid shield and weapon behavior', () => {
    const a = fixture();
    a.step(frame({ shield: true }));
    expect(a.ship.energy).toBeCloseTo(a.ship.maxEnergy! - a.ship.stats!.shieldCost * 0.1, 6);
    const before = a.ship.energy!;
    a.step(frame({ fire: true }));
    expect(a.ship.energy).toBeCloseTo(before - a.ship.stats!.primaryWeapon.fireCost, 6);
  });
});

type Stroke = { color: string; start: [number, number]; end: [number, number] };
function shipStrokes(state: GameState): Stroke[] {
  const out: Stroke[] = [];
  let points: [number, number][] = [];
  const stack: string[] = [];
  const context = {
    strokeStyle: '#ffffff',
    save() { stack.push(this.strokeStyle); },
    restore() { this.strokeStyle = stack.pop() ?? '#ffffff'; },
    setTransform() {}, translate() {}, rotate() {}, rect() {}, clip() {},
    fillRect() {}, strokeRect() {}, arc() {}, closePath() {}, fill() {},
    beginPath() { points = []; },
    moveTo(x: number, y: number) { points.push([x, y]); },
    lineTo(x: number, y: number) { points.push([x, y]); },
    stroke() {
      if (points.length >= 2) out.push({
        color: this.strokeStyle, start: points[0]!, end: points[points.length - 1]!,
      });
    },
  };
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  new CanvasRenderer(canvas).render(state, 'p1');
  return out;
}

describe('visible maneuver attribution', () => {
  it('shows no front/rear flames during passive coast', () => {
    const a = fixture();
    a.ship.velocity.x = 70;
    a.step(frame());
    const strokes = shipStrokes(a.state);
    expect(strokes.some(s => s.color === '#65d9ff')).toBe(false);
    expect(strokes.some(s => s.color === '#ff6600')).toBe(false);
  });

  it('shows opposite-side nose jets for each paid turn and rear orange for thrust', () => {
    const a = fixture();
    a.step(frame({ left: true, thrust: true }));
    const left = shipStrokes(a.state);
    const leftNose = left.find(s => s.color === '#65d9ff');
    expect(leftNose).toBeDefined();
    expect(leftNose!.start[0]).toBeGreaterThan(0);
    expect(leftNose!.end[1]).toBeGreaterThan(0);
    expect(left.some(s => s.color === '#ff6600')).toBe(true);

    a.step(frame({ right: true }));
    const right = shipStrokes(a.state);
    const rightNose = right.find(s => s.color === '#65d9ff');
    expect(rightNose).toBeDefined();
    expect(rightNose!.end[1]).toBeLessThan(0);
    expect(right.some(s => s.color === '#ff6600')).toBe(false);
  });
});
