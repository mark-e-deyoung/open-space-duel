import { Entity, EntityType, generateId } from '../engine/state';

export function createPlanet(x: number, y: number, radius: number = 80): Entity {
  return {
    id: generateId(),
    type: EntityType.Planet,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    radius,
    isActive: true,
  };
}
