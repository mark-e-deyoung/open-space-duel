import {
  Entity,
  EntityType,
  generateId,
  ShipClass,
  ShipStats,
  ShipCustomization,
} from '../engine/state';

export const SHIP_CONFIGS: Record<ShipClass, ShipStats> = {
  [ShipClass.Standard]: {
    acceleration: 200,
    rotationSpeed: Math.PI * 1.5,
    maxEnergy: 100,
    rechargeRate: 30,
    thrustCost: 20,
    shieldCost: 60,
    primaryColor: '#00ffcc', // Teal
    secondaryColor: '#ff00ff', // Magenta
    primaryWeapon: {
      fireCost: 10,
      cooldown: 0.2,
      projectileSpeed: 400,
      projectileLife: 1.5,
      projectileRadius: 2,
      projectileColor: '#00ffcc',
      type: 'linear',
    },
    secondaryWeapon: {
      fireCost: 25,
      cooldown: 0.5,
      projectileSpeed: 350,
      projectileLife: 1.2,
      projectileRadius: 2,
      projectileColor: '#ff00ff',
      type: 'triple',
    },
  },
  [ShipClass.Interceptor]: {
    acceleration: 450,
    rotationSpeed: Math.PI * 2.5,
    maxEnergy: 60,
    rechargeRate: 45,
    thrustCost: 60,
    shieldCost: 90,
    primaryColor: '#ffff00', // Yellow
    secondaryColor: '#00ff00', // Lime Green
    primaryWeapon: {
      fireCost: 8,
      cooldown: 0.15,
      projectileSpeed: 500,
      projectileLife: 0.75,
      projectileRadius: 1.5,
      projectileColor: '#ffff00',
      type: 'burst',
    },
    secondaryWeapon: {
      fireCost: 30,
      cooldown: 0.4,
      projectileSpeed: 450,
      projectileLife: 0.8,
      projectileRadius: 2,
      projectileColor: '#00ff00',
      type: 'burst',
    },
  },
  [ShipClass.Dreadnought]: {
    acceleration: 120,
    rotationSpeed: Math.PI,
    maxEnergy: 200,
    rechargeRate: 15,
    thrustCost: 15,
    shieldCost: 30,
    primaryColor: '#0066ff', // Blue
    secondaryColor: '#9933ff', // Purple
    primaryWeapon: {
      fireCost: 20,
      cooldown: 0.4,
      projectileSpeed: 300,
      projectileLife: 2.0,
      projectileRadius: 4,
      projectileColor: '#0066ff',
      type: 'heavy',
    },
    secondaryWeapon: {
      fireCost: 50,
      cooldown: 0.8,
      projectileSpeed: 250,
      projectileLife: 1.5,
      projectileRadius: 3,
      projectileColor: '#9933ff',
      type: 'triple',
    },
  },
};

export function createShip(
  x: number,
  y: number,
  ownerId: string,
  shipClass: ShipClass = ShipClass.Standard,
  color?: string,
  customization?: ShipCustomization,
): Entity {
  const baseStats = SHIP_CONFIGS[shipClass];

  // Apply customization
  const stats = { ...baseStats };
  if (customization) {
    // Stat focus affects bonuses. -5 (Shields) to +5 (Speed)
    // If explicit bonuses are provided (e.g. from network), use them, otherwise calculate from statFocus
    const speedBonus =
      customization.speedBonus ??
      (customization.statFocus > 0 ? customization.statFocus : 0);
    const shieldBonus =
      customization.shieldBonus ??
      (customization.statFocus < 0 ? Math.abs(customization.statFocus) : 0);

    // Speed bonus increases acceleration and rotation speed (+10% per point)
    const speedMult = 1 + speedBonus * 0.1;
    stats.acceleration *= speedMult;
    stats.rotationSpeed *= speedMult;

    // Shield bonus increases max energy and recharge rate (+10% per point)
    const shieldMult = 1 + shieldBonus * 0.1;
    stats.maxEnergy *= shieldMult;
    stats.rechargeRate *= shieldMult;
  }

  return {
    id: generateId(),
    type: EntityType.Ship,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: -Math.PI / 2, // Point up
    radius: 10,
    isActive: true,
    ownerId,
    invulnerabilityTimer: 3.0, // 3 seconds of invulnerability on spawn
    energy: stats.maxEnergy,
    maxEnergy: stats.maxEnergy,
    isShieldActive: false,
    shipClass,
    stats,
    primaryCooldown: 0,
    secondaryCooldown: 0,
    color: color || baseStats.primaryColor,
  };
}
