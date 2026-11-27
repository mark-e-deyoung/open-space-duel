import { Entity, EntityType, generateId } from '../engine/state';

export function createSpaceStorm(x: number, y: number, radius: number = 150): Entity {
  return {
    id: generateId(),
    type: EntityType.SpaceStorm,
    position: { x, y },
    velocity: { x: 0, y: 0 }, // Maybe slowly drifts later
    rotation: 0,
    radius,
    isActive: true,
  };
}
