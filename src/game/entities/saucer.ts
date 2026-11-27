import { Entity, EntityType, generateId } from '../engine/state';

export function createSaucer(x: number, y: number): Entity {
  return {
    id: generateId(),
    type: EntityType.Saucer,
    position: { x, y },
    velocity: { x: 50, y: 30 }, // Fixed initial velocity, will bounce or wrap
    rotation: 0,
    radius: 15,
    isActive: true,
  };
}
