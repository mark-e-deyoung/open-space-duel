import { Entity, EntityType, generateId } from '../engine/state';

export function createAsteroid(x: number, y: number, vx: number, vy: number, radius: number): Entity {
  return {
    id: generateId(),
    type: EntityType.Asteroid,
    position: { x, y },
    velocity: { x: vx, y: vy },
    rotation: 0, // We can optionally rotate them over time
    radius,
    isActive: true,
  };
}
