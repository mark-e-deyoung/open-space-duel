import { Entity, EntityType, generateId } from '../engine/state';

export function createGravityWell(
  x: number,
  y: number,
  radius: number = 40,
): Entity {
  return {
    id: generateId(),
    type: EntityType.GravityWell,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    radius,
    isActive: true,
    gravityMode: 'pull',
    gravityCooldown: 5 + Math.random() * 5,
  };
}
