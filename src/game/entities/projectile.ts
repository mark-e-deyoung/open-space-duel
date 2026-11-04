import { Entity, EntityType, generateId } from '../engine/state';

export function createProjectile(
  x: number,
  y: number,
  rotation: number,
  ownerId: string,
  speed: number = 400,
  lifeTime: number = 1.5,
  radius: number = 2,
  color: string = '#ff00ff',
  radiusGrowthFactor: number = 0,
): Entity {
  return {
    id: generateId(),
    type: EntityType.Projectile,
    position: { x, y },
    velocity: {
      x: Math.cos(rotation) * speed,
      y: Math.sin(rotation) * speed,
    },
    rotation,
    radius,
    isActive: true,
    ownerId,
    initialRadius: radius,
    initialLifeTime: lifeTime,
    radiusGrowthFactor,
    lifeTime,
    color,
  };
}
