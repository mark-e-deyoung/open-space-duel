import { Entity, EntityType, generateId } from '../engine/state';

export function createSpaceSnake(
  x: number,
  y: number,
  radius: number = 15,
  length: number = 10,
  angle: number = 0,
): Entity[] {
  const speed = 100;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const segments: Entity[] = [];

  // Create segments. Head is the first element, rest follow.
  // We'll manage following logic in updatePhysics.
  // We assign a special property or color to distinguish head from body if we want,
  // but for simplicity, we can link them by ownerId or just treat them as a swarm.
  // Actually, a simple snake just has a head that leads, and bodies that follow the position history.
  // For the MVP of this challenge, let's just make it a chain of entities that split when destroyed.

  const snakeId = generateId(); // Use ownerId as snake chain id

  for (let i = 0; i < length; i++) {
    segments.push({
      id: generateId(),
      type: EntityType.SpaceSnake,
      position: {
        x: x - Math.cos(angle) * radius * 2 * i,
        y: y - Math.sin(angle) * radius * 2 * i,
      },
      velocity: { x: vx, y: vy },
      rotation: angle,
      radius,
      isActive: true,
      ownerId: snakeId, // Links the snake
      snakeState: i === 0 ? 'hunting' : undefined,
      snakeTimer: i === 0 ? 0 : undefined,
    });
  }
  return segments;
}
