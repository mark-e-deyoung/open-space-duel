import { Entity, EntityType, BoosterType, generateId } from '../engine/state';

export function createBooster(x: number, y: number, type: BoosterType): Entity {
  return {
    id: generateId(),
    type: EntityType.Booster,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    radius: 12,
    isActive: true,
    boosterType: type,
    color: getBoosterColor(type),
  };
}

function getBoosterColor(type: BoosterType): string {
  switch (type) {
    case BoosterType.InfinityCapacitor:
      return '#ffff00'; // Yellow
    case BoosterType.VectorTorpedo:
      return '#ff00ff'; // Magenta
    case BoosterType.PhaseShift:
      return '#00ffff'; // Cyan
    case BoosterType.EMPBlast:
      return '#ff6600'; // Orange
    case BoosterType.GravityAnchor:
      return '#0066ff'; // Blue
    case BoosterType.ExtraLife:
      return '#00ff00'; // Green
    case BoosterType.AutoShield:
      return '#66ccff'; // Light cyan
    default:
      return '#ffffff';
  }
}

export function updateBoosters(entities: Entity[], dt: number) {
  // Boosters are static but could have a slow rotation or pulsation effect
  entities.forEach((e) => {
    if (e.type === EntityType.Booster) {
      e.rotation += dt;
      // Apply some drag so they slow down after being pushed
      e.velocity.x *= 0.98;
      e.velocity.y *= 0.98;
    }
  });
}
