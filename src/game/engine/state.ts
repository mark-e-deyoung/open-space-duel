export interface Vector2 {
  x: number;
  y: number;
}

export enum EntityType {
  Ship = 'ship',
  Projectile = 'projectile',
  Asteroid = 'asteroid',
  Saucer = 'saucer',
  GravityWell = 'gravityWell',
  Planet = 'planet',
  SpaceStorm = 'spaceStorm',
  SpaceSnake = 'spaceSnake',
  Booster = 'booster',
}

export enum BoosterType {
  InfinityCapacitor = 'infinityCapacitor',
  VectorTorpedo = 'vectorTorpedo',
  PhaseShift = 'phaseShift',
  EMPBlast = 'empBlast',
  GravityAnchor = 'gravityAnchor',
  ExtraLife = 'extraLife',
  AutoShield = 'autoShield',
}

export interface PlayerBooster {
  type: BoosterType;
  remainingDuration?: number;
  charges?: number;
}

export enum ShipClass {
  Interceptor = 'interceptor',
  Dreadnought = 'dreadnought',
  Standard = 'standard',
}

export interface WeaponConfig {
  fireCost: number;
  cooldown: number;
  projectileSpeed: number;
  projectileLife: number;
  projectileRadius: number;
  projectileColor: string;
  type: 'linear' | 'triple' | 'burst' | 'heavy';
}

export interface ShipStats {
  acceleration: number;
  rotationSpeed: number;
  maxEnergy: number;
  rechargeRate: number;
  thrustCost: number;
  /** Energy units per second at full steering rate. */
  steeringCost: number;
  shieldCost: number;
  primaryColor: string;
  secondaryColor: string;
  primaryWeapon: WeaponConfig;
  secondaryWeapon: WeaponConfig;
}

export interface Entity {
  id: string;
  type: EntityType;
  position: Vector2;
  velocity: Vector2;
  rotation: number;
  radius: number;
  isActive: boolean;
  // Specific properties
  ownerId?: string;
  lifeTime?: number;
  invulnerabilityTimer?: number;
  energy?: number;
  maxEnergy?: number;
  isShieldActive?: boolean;
  isThrusting?: boolean;
  /** Signed paid attitude maneuver: -1 left, +1 right, 0 idle. */
  steeringDirection?: -1 | 0 | 1;
  shipClass?: ShipClass;
  stats?: ShipStats;
  primaryCooldown?: number;
  secondaryCooldown?: number;
  collisionCooldown?: number;
  environmentCooldown?: number;
  color?: string;
  boosterType?: BoosterType;
  initialRadius?: number;
  initialLifeTime?: number;
  radiusGrowthFactor?: number;
  gravityMode?: 'pull' | 'push';
  gravityCooldown?: number;
  // NPC States
  snakeState?: 'hunting' | 'coiling' | 'striking' | 'resting';
  snakeTimer?: number;
}

export interface Particle {
  position: Vector2;
  velocity: Vector2;
  color: string;
  life: number; // 0 to 1
  size: number;
}

export interface ShipCustomization {
  statFocus: number; // e.g. -5 to 5
  speedBonus?: number;
  shieldBonus?: number;
}

export interface PlayerInput {
  thrust: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  fireSecondary: boolean;
  shield: boolean;
  pause?: boolean;
  customization?: ShipCustomization;
  targetRotation?: number;
}

export interface MatchSettings {
  boostersEnabled: boolean;
  boosterRate: 'rare' | 'normal' | 'chaos';
  asteroidDensity: number; // 0 to 10
  hazardsEnabled: boolean;
  screenShake: number; // 0 to 1
  gameSpeed: number; // 0.8 to 1.5
  unlimitedEnergy: boolean;
  waveCompositions: string[]; // Compositions for waves 1, 2, 3, 4
}

export interface GameState {
  tick: number;
  seed: number;
  /** Mutable PRNG state — initialized from seed, advanced each call to next(). */
  prngState: number;
  entities: Entity[];
  particles: Particle[];
  score: { [playerId: string]: number };
  lives: { [playerId: string]: number };
  seriesWins: { [playerId: string]: number };
  requiredWins: number;
  scoreMultiplier: number;
  playerShipClasses: { [playerId: string]: ShipClass };
  playerCustomizations: { [playerId: string]: ShipCustomization };
  playerCallSigns: { [playerId: string]: string };
  playerBoosters: { [playerId: string]: PlayerBooster[] };
  settings: MatchSettings;
  worldWidth: number;
  worldHeight: number;
  wave: number;
  /** Last tick when a booster was spawned. Persisted per-game for determinism. */
  lastBoosterSpawnTick: number;
  /** Serialized bot memory snapshot — written by server-peer, ignored by SPA. */
  botMemorySnapshot?: Record<string, unknown>;
  isGameOver: boolean;
  isPaused: boolean;
  gameOverCountdown?: number;
}

export const TEMPORAL_CONFIG = {
  ICE_GATHERING_TIMEOUT: 10000,
  HEARTBEAT_TIMEOUT: 3000,
  INITIAL_BACKOFF_INTERVAL: 1000 * 60 * 5, // 5 minutes
  MAX_BACKOFF_INTERVAL: 1000 * 60 * 60, // 1 hour
};

export function createInitialState(
  worldWidth: number,
  worldHeight: number,
  seed: number,
  requiredWins: number = 1,
): GameState {
  return {
    tick: 0,
    seed,
    prngState: seed,
    entities: [],
    particles: [],
    score: {},
    lives: {},
    seriesWins: {},
    requiredWins,
    scoreMultiplier: 1.0,
    playerShipClasses: {},
    playerCustomizations: {},
    playerCallSigns: {},
    playerBoosters: {},
    settings: {
      boostersEnabled: true,
      boosterRate: 'normal',
      asteroidDensity: 5,
      hazardsEnabled: true,
      screenShake: 1.0,
      gameSpeed: 1.0,
      unlimitedEnergy: false,
      waveCompositions: ['classic', 'anomaly', 'blockade', 'swarm'],
    },
    worldWidth,
    worldHeight,
    wave: 1,
    lastBoosterSpawnTick: 0,
    isGameOver: false,
    isPaused: false,
    gameOverCountdown: undefined,
  };
}

export function generateId(): string {
  return crypto.randomUUID();
}
