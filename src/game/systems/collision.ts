import {
  Entity,
  GameState,
  EntityType,
  BoosterType,
  PlayerBooster,
} from '../engine/state';
import { createAsteroid } from '../entities/asteroid';
import { DeterministicRNG } from '../../sim/prng';

const ASTEROID_SPLIT_COOLDOWN = 0.75;
const ENVIRONMENT_COOLDOWN = 0.5;
const BOUNCE_SPEED_MIN = 60;
const BOUNCE_SPEED_MAX = 220;

function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

export function checkCollisions(
  state: GameState,
  onCollision?: (
    pos: { x: number; y: number },
    strength: number,
    isDramatic?: boolean,
  ) => void,
) {
  // Deterministic PRNG for all random decisions in this tick's collisions
  const rng = new DeterministicRNG(state.prngState);

  // Active entity snapshot — filtered once before O(n²) all-pairs check.
  // Copied because entities may be deactivated during collision iteration.
  const activeEntities = state.entities.filter((e) => e.isActive);

  for (let i = 0; i < activeEntities.length; i++) {
    const e1 = activeEntities[i]!;
    if (!e1.isActive) continue;

    for (let j = i + 1; j < activeEntities.length; j++) {
      if (!e1.isActive) break;

      const e2 = activeEntities[j]!;
      if (!e2.isActive) continue;

      // Ignore projectiles colliding with their owners
      if (isProjectileOwnedByEntity(e1, e2)) continue;
      if (isProjectileOwnedByEntity(e2, e1)) continue;

      // Ignore two projectiles colliding
      if (
        e1.type === EntityType.Projectile &&
        e2.type === EntityType.Projectile
      )
        continue;

      // Ignore segments of the same snake colliding
      if (
        e1.type === EntityType.SpaceSnake &&
        e2.type === EntityType.SpaceSnake &&
        e1.ownerId === e2.ownerId
      )
        continue;

      const minDist = e1.radius + e2.radius;
      if (
        distanceSq(e1.position.x, e1.position.y, e2.position.x, e2.position.y) <
        minDist * minDist
      ) {
        handleCollision(state, e1, e2, rng, onCollision);
      }
    }
  }
  // Save PRNG state for deterministic replay
  state.prngState = rng.currentState;
}

function isProjectileOwnedByEntity(
  projectile: Entity,
  entity: Entity,
): boolean {
  return (
    projectile.type === EntityType.Projectile &&
    entity.type === EntityType.Ship &&
    projectile.ownerId !== undefined &&
    projectile.ownerId === entity.ownerId
  );
}

function handleCollision(
  state: GameState,
  e1: Entity,
  e2: Entity,
  rng: DeterministicRNG,
  onCollision?: (
    pos: { x: number; y: number },
    strength: number,
    isDramatic?: boolean,
  ) => void,
) {
  // 1. Booster Pickups
  if (e1.type === EntityType.Ship && e2.type === EntityType.Booster) {
    handleBoosterPickup(state, e1, e2, rng);
    return;
  }
  if (e2.type === EntityType.Ship && e1.type === EntityType.Booster) {
    handleBoosterPickup(state, e2, e1, rng);
    return;
  }

  // 2. Booster Physical Interaction (Pushing)
  if (e1.type === EntityType.Booster || e2.type === EntityType.Booster) {
    handleBoosterPush(state, e1, e2, rng, onCollision);
    return;
  }

  // Phase Shift (Ghost) Check: Ghost ships pass through everything
  if (e1.type === EntityType.Ship && e1.ownerId) {
    const active = state.playerBoosters[e1.ownerId] || [];
    if (active.some((b) => b.type === BoosterType.PhaseShift)) return;
  }
  if (e2.type === EntityType.Ship && e2.ownerId) {
    const active = state.playerBoosters[e2.ownerId] || [];
    if (active.some((b) => b.type === BoosterType.PhaseShift)) return;
  }

  // 3. Environmental Collisions (SpaceStorm, GravityWell) - Non-destructive
  if (e1.type === EntityType.SpaceStorm || e2.type === EntityType.SpaceStorm) {
    const storm = e1.type === EntityType.SpaceStorm ? e1 : e2;
    const other = e1.type === EntityType.SpaceStorm ? e2 : e1;
    handleSpaceStormCollision(storm, other, rng);
    return;
  }

  if (
    e1.type === EntityType.GravityWell ||
    e2.type === EntityType.GravityWell
  ) {
    const well = e1.type === EntityType.GravityWell ? e1 : e2;
    const other = e1.type === EntityType.GravityWell ? e2 : e1;
    handleGravityWellCollision(state, well, other, rng);
    return;
  }

  if (e1.type === EntityType.Planet || e2.type === EntityType.Planet) {
    const planet = e1.type === EntityType.Planet ? e1 : e2;
    const other = e1.type === EntityType.Planet ? e2 : e1;
    handlePlanetCollision(planet, other);
    return;
  }

  const autoShielded =
    e1.type !== EntityType.Projectile &&
    e2.type !== EntityType.Projectile &&
    ((e1.type === EntityType.Ship &&
      tryActivateAutoShield(state, e1, e2, rng)) ||
      (e2.type === EntityType.Ship &&
        tryActivateAutoShield(state, e2, e1, rng)));
  if (autoShielded) return;

  // 2. Planet Collisions (currently behaves like hard wall, but we treat it as destructive for now as per original code implicit)
  // Original code skipped GravityWells but not Planets.

  // 3. Asteroid-to-Asteroid Collision
  if (e1.type === EntityType.Asteroid && e2.type === EntityType.Asteroid) {
    handleAsteroidToAsteroid(state, e1, e2, rng, onCollision);
    return;
  }

  // 3.5 Saucer-to-Asteroid Collision (Saucers are asteroid-proof)
  if (
    (e1.type === EntityType.Saucer && e2.type === EntityType.Asteroid) ||
    (e2.type === EntityType.Saucer && e1.type === EntityType.Asteroid)
  ) {
    const saucer = e1.type === EntityType.Saucer ? e1 : e2;
    const asteroid = e1.type === EntityType.Asteroid ? e1 : e2;
    bounceSaucerOffAsteroid(saucer, asteroid, rng);
    return;
  }

  // 4. Standard Destructive Collisions
  // Ignore collision if either is an invulnerable ship or has active shield
  if (
    e1.type === EntityType.Ship &&
    ((e1.invulnerabilityTimer ?? 0) > 0 || e1.isShieldActive)
  )
    return;
  if (
    e2.type === EntityType.Ship &&
    ((e2.invulnerabilityTimer ?? 0) > 0 || e2.isShieldActive)
  )
    return;

  // Trigger Screen Shake
  const avgX = (e1.position.x + e2.position.x) / 2;
  const avgY = (e1.position.y + e2.position.y) / 2;

  let isDramatic = false;
  let shipDestroyed = false;

  // Check if a ship is about to be destroyed and if it's their last life
  if (e1.type === EntityType.Ship && e1.ownerId) {
    shipDestroyed = true;
    if ((state.lives[e1.ownerId] || 0) <= 1) isDramatic = true;
  }
  if (e2.type === EntityType.Ship && e2.ownerId) {
    shipDestroyed = true;
    if ((state.lives[e2.ownerId] || 0) <= 1) isDramatic = true;
  }

  // Saucers are also dramatic to destroy
  if (e1.type === EntityType.Saucer || e2.type === EntityType.Saucer) {
    isDramatic = true;
  }

  const strength = isDramatic ? 40 : shipDestroyed ? 15 : 10;
  onCollision?.({ x: avgX, y: avgY }, strength, isDramatic);

  // Create Explosion Particles
  createExplosion(
    state,
    avgX,
    avgY,
    isDramatic ? 100 : shipDestroyed ? 40 : 15,
    isDramatic,
    rng,
  );

  // Asteroid Splitting Logic (from Projectiles)
  if (e1.type === EntityType.Asteroid) handleAsteroidSplit(state, e1, e2);
  if (e2.type === EntityType.Asteroid) handleAsteroidSplit(state, e2, e1);

  // Simple: both get destroyed
  e1.isActive = false;
  e2.isActive = false;

  // Handle ship death lives decrease
  if (e1.type === EntityType.Ship && e1.ownerId) {
    state.lives[e1.ownerId] = Math.max(0, (state.lives[e1.ownerId] || 0) - 1);
  }
  if (e2.type === EntityType.Ship && e2.ownerId) {
    state.lives[e2.ownerId] = Math.max(0, (state.lives[e2.ownerId] || 0) - 1);
  }

  // Add scoring logic based on what destroyed what
  let killerId = null;
  if (e1.type === EntityType.Projectile && e1.ownerId) killerId = e1.ownerId;
  if (e2.type === EntityType.Projectile && e2.ownerId) killerId = e2.ownerId;

  if (killerId) {
    if (!state.score[killerId!]) state.score[killerId!] = 0;
    if (e1.type === EntityType.Asteroid || e2.type === EntityType.Asteroid) {
      state.score[killerId!] = (state.score[killerId!] ?? 0) + 100;
    } else if (e1.type === EntityType.Ship || e2.type === EntityType.Ship) {
      state.score[killerId!] = (state.score[killerId!] ?? 0) + 500;
    } else if (
      e1.type === EntityType.SpaceSnake ||
      e2.type === EntityType.SpaceSnake
    ) {
      state.score[killerId!] = (state.score[killerId!] ?? 0) + 200;
    } else if (e1.type === EntityType.Saucer || e2.type === EntityType.Saucer) {
      state.score[killerId!] = (state.score[killerId!] ?? 0) + 1000;
    }
  }
}

function handleBoosterPickup(
  state: GameState,
  ship: Entity,
  booster: Entity,
  rng: DeterministicRNG,
) {
  if (!ship.ownerId || !booster.boosterType) return;

  if (!state.playerBoosters[ship.ownerId]) {
    state.playerBoosters[ship.ownerId] = [];
  }

  // Handle instant boosters
  if (booster.boosterType === BoosterType.EMPBlast) {
    // Deplete everyone else's energy
    state.entities.forEach((e) => {
      if (e.type === EntityType.Ship && e.ownerId !== ship.ownerId) {
        e.energy = 0;
        createExplosion(state, e.position.x, e.position.y, 10, false, rng);
      }
    });
    booster.isActive = false;
    return;
  }

  if (booster.boosterType === BoosterType.ExtraLife) {
    state.lives[ship.ownerId] = Math.min(
      5,
      (state.lives[ship.ownerId] || 0) + 1,
    );
    createExplosion(state, ship.position.x, ship.position.y, 20, false, rng);
    booster.isActive = false;
    return;
  }

  if (booster.boosterType === BoosterType.AutoShield) {
    const newBooster: PlayerBooster = {
      type: booster.boosterType,
      charges: 3,
    };
    state.playerBoosters[ship.ownerId] = [newBooster];
    booster.isActive = false;
    if (!state.score[ship.ownerId!]) state.score[ship.ownerId!] = 0;
    state.score[ship.ownerId!] = (state.score[ship.ownerId!] ?? 0) + 250;
    return;
  }

  const newBooster: PlayerBooster = {
    type: booster.boosterType,
    remainingDuration:
      booster.boosterType === BoosterType.InfinityCapacitor ||
      booster.boosterType === BoosterType.PhaseShift ||
      booster.boosterType === BoosterType.GravityAnchor
        ? 10
        : undefined,
    charges: booster.boosterType === BoosterType.VectorTorpedo ? 5 : undefined,
  };

  // Replacement Policy: Clear existing tactical boosters before adding new one
  state.playerBoosters[ship.ownerId] = [newBooster];
  booster.isActive = false;

  // Scoring / Feedback
  if (!state.score[ship.ownerId!]) state.score[ship.ownerId!] = 0;
  state.score[ship.ownerId!] = (state.score[ship.ownerId!] ?? 0) + 250;
}

function handleBoosterPush(
  state: GameState,
  e1: Entity,
  e2: Entity,
  rng: DeterministicRNG,
  onCollision?: (
    pos: { x: number; y: number },
    strength: number,
    isDramatic?: boolean,
  ) => void,
) {
  const booster = e1.type === EntityType.Booster ? e1 : e2;
  const other = e1.type === EntityType.Booster ? e2 : e1;

  if (other.type === EntityType.Projectile) {
    // 10% chance of destruction
    if (rng.next() < 0.1) {
      booster.isActive = false;
      other.isActive = false;
      onCollision?.(booster.position, 15);
      createExplosion(
        state,
        booster.position.x,
        booster.position.y,
        20,
        false,
        rng,
      );
      return;
    }
  }

  // Elastic-ish bounce for pushing
  const dx = booster.position.x - other.position.x;
  const dy = booster.position.y - other.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  const pushStrength = other.type === EntityType.Projectile ? 150 : 80;
  booster.velocity.x = nx * pushStrength;
  booster.velocity.y = ny * pushStrength;

  if (other.type === EntityType.Projectile) {
    other.isActive = false;
  }
}

function handleSpaceStormCollision(
  storm: Entity,
  other: Entity,
  rng: DeterministicRNG,
) {
  if (other.type === EntityType.Projectile) return; // Projectiles pass through? (as per original logic they were destroyed, but Storm is environmental now)
  if ((other.environmentCooldown ?? 0) > 0) return;

  // Simulate being lost in fog: random exit speed and direction
  const angle = rng.next() * Math.PI * 2;
  const speed =
    BOUNCE_SPEED_MIN + rng.next() * (BOUNCE_SPEED_MAX - BOUNCE_SPEED_MIN);

  other.velocity.x = Math.cos(angle) * speed;
  other.velocity.y = Math.sin(angle) * speed;
  other.environmentCooldown = ENVIRONMENT_COOLDOWN;

  // Nudge outside storm radius
  const nudgeDist = storm.radius + other.radius + 1;
  other.position.x = storm.position.x + Math.cos(angle) * nudgeDist;
  other.position.y = storm.position.y + Math.sin(angle) * nudgeDist;
}

function handleGravityWellCollision(
  state: GameState,
  well: Entity,
  other: Entity,
  rng: DeterministicRNG,
) {
  if (other.type === EntityType.Projectile) {
    const dx = other.position.x - well.position.x;
    const dy = other.position.y - well.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const rx = dx / dist;
    const ry = dy / dist;
    const tx = -ry;
    const ty = rx;
    const speed = Math.sqrt(
      other.velocity.x * other.velocity.x + other.velocity.y * other.velocity.y,
    );
    const exitSpeed = Math.max(speed * 1.05, BOUNCE_SPEED_MIN);
    other.velocity.x = (tx * 0.7 + rx * 0.3) * exitSpeed;
    other.velocity.y = (ty * 0.7 + ry * 0.3) * exitSpeed;
    other.environmentCooldown = ENVIRONMENT_COOLDOWN;
    const nudgeDist = well.radius + other.radius + 1;
    other.position.x = well.position.x + rx * nudgeDist;
    other.position.y = well.position.y + ry * nudgeDist;
    state.particles.push(
      ...createDeflectionParticles(
        well.position.x,
        well.position.y,
        well.gravityMode === 'push' ? '#ff9966' : '#66ccff',
        rng,
      ),
    );
    return;
  }
  if ((other.environmentCooldown ?? 0) > 0) return;

  // Slingshot ejection
  const dx = other.position.x - well.position.x;
  const dy = other.position.y - well.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Radial vector (normalized)
  const rx = dx / dist;
  const ry = dy / dist;

  // Tangent vector (perpendicular to radial)
  const tx = -ry;
  const ty = rx;

  // Current speed
  const speed = Math.sqrt(
    other.velocity.x * other.velocity.x + other.velocity.y * other.velocity.y,
  );
  const exitSpeed = Math.max(speed * 1.1, BOUNCE_SPEED_MIN);

  // Blend tangential with some radial push out
  other.velocity.x = (tx * 0.8 + rx * 0.2) * exitSpeed;
  other.velocity.y = (ty * 0.8 + ry * 0.2) * exitSpeed;

  other.environmentCooldown = ENVIRONMENT_COOLDOWN;

  // Move just outside well
  const nudgeDist = well.radius + other.radius + 1;
  other.position.x = well.position.x + rx * nudgeDist;
  other.position.y = well.position.y + ry * nudgeDist;
}

function handlePlanetCollision(planet: Entity, other: Entity) {
  if (other.type === EntityType.Projectile) {
    other.isActive = false;
    return;
  }

  // 1. Calculate radial vector (Planet -> Object)
  const dx = other.position.x - planet.position.x;
  const dy = other.position.y - planet.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const rx = dx / dist;
  const ry = dy / dist;

  // 2. Snap to surface
  const surfaceDist = planet.radius + other.radius;
  other.position.x = planet.position.x + rx * surfaceDist;
  other.position.y = planet.position.y + ry * surfaceDist;

  // 3. Convert velocity to purely tangential (Orbit)
  // Tangent is perpendicular to radial
  const tx = -ry;
  const ty = rx;

  // Project existing velocity onto tangent
  const dot = other.velocity.x * tx + other.velocity.y * ty;

  // Preserve direction but ensure a minimum orbital speed
  const orbitalSpeed = Math.max(Math.abs(dot), 100);
  const direction = dot < 0 ? -1 : 1;

  other.velocity.x = tx * orbitalSpeed * direction;
  other.velocity.y = ty * orbitalSpeed * direction;

  // Brief cooldown to allow movement but prevent re-triggering same frame
  other.environmentCooldown = 0.05;
}

function handleAsteroidToAsteroid(
  state: GameState,
  a1: Entity,
  a2: Entity,
  rng: DeterministicRNG,
  onCollision?: (
    pos: { x: number; y: number },
    strength: number,
    isDramatic?: boolean,
  ) => void,
) {
  const canSplit =
    a1.radius > 10 &&
    a2.radius > 10 &&
    (a1.collisionCooldown ?? 0) <= 0 &&
    (a2.collisionCooldown ?? 0) <= 0;

  if (canSplit && rng.next() < 0.5) {
    // Split both
    handleAsteroidSplit(state, a1, a2);
    handleAsteroidSplit(state, a2, a1);
    a1.isActive = false;
    a2.isActive = false;

    const avgX = (a1.position.x + a2.position.x) / 2;
    const avgY = (a1.position.y + a2.position.y) / 2;
    onCollision?.({ x: avgX, y: avgY }, 5);
    createExplosion(state, avgX, avgY, 15, false, rng);
  } else {
    // Bounce
    bounceAsteroids(a1, a2, rng);
  }
}

function bounceAsteroids(a1: Entity, a2: Entity, rng: DeterministicRNG) {
  const dx = a2.position.x - a1.position.x;
  const dy = a2.position.y - a1.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Normalized collision vector
  const nx = dx / dist;
  const ny = dy / dist;

  // Randomized bounce speed
  const s1 = BOUCNCE_SPEED(rng);
  const s2 = BOUCNCE_SPEED(rng);

  a1.velocity.x = -nx * s1;
  a1.velocity.y = -ny * s1;
  a2.velocity.x = nx * s2;
  a2.velocity.y = ny * s2;

  // Separate overlapping asteroids
  const overlap = a1.radius + a2.radius - dist + 1;
  a1.position.x -= nx * (overlap / 2);
  a1.position.y -= ny * (overlap / 2);
  a2.position.x += nx * (overlap / 2);
  a2.position.y += ny * (overlap / 2);
}

function bounceSaucerOffAsteroid(
  saucer: Entity,
  asteroid: Entity,
  rng: DeterministicRNG,
) {
  const dx = saucer.position.x - asteroid.position.x;
  const dy = saucer.position.y - asteroid.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  const nx = dx / dist;
  const ny = dy / dist;

  // Saucer is heavy and deflects asteroid more than it is deflected
  const saucerSpeed = 100;
  const asteroidSpeed = BOUCNCE_SPEED(rng) * 1.5;

  saucer.velocity.x = nx * saucerSpeed;
  saucer.velocity.y = ny * saucerSpeed;
  asteroid.velocity.x = -nx * asteroidSpeed;
  asteroid.velocity.y = -ny * asteroidSpeed;

  // Separate to prevent sticking
  const overlap = saucer.radius + asteroid.radius - dist + 1;
  saucer.position.x += nx * overlap;
  saucer.position.y += ny * overlap;
}

function BOUCNCE_SPEED(rng: DeterministicRNG): number {
  return BOUNCE_SPEED_MIN + rng.next() * (BOUNCE_SPEED_MAX - BOUNCE_SPEED_MIN);
}

function handleAsteroidSplit(
  state: GameState,
  asteroid: Entity,
  other: Entity,
) {
  if (asteroid.radius <= 10) return;
  // If hit by projectile, or explicitly triggered by asteroid-asteroid
  const isTriggeredByProjectile = other.type === EntityType.Projectile;
  const isTriggeredByAsteroid = other.type === EntityType.Asteroid;

  if (isTriggeredByProjectile || isTriggeredByAsteroid) {
    const newRadius = asteroid.radius / 2;
    const angleOffset = Math.PI / 4;

    const vMagnitude = Math.sqrt(
      asteroid.velocity.x * asteroid.velocity.x +
        asteroid.velocity.y * asteroid.velocity.y,
    );
    const vAngle = Math.atan2(asteroid.velocity.y, asteroid.velocity.x);

    const newSpeed = Math.max(vMagnitude * 1.5, 50);

    const a1 = createAsteroid(
      asteroid.position.x + Math.cos(vAngle + angleOffset) * newRadius,
      asteroid.position.y + Math.sin(vAngle + angleOffset) * newRadius,
      Math.cos(vAngle + angleOffset) * newSpeed,
      Math.sin(vAngle + angleOffset) * newSpeed,
      newRadius,
    );

    const a2 = createAsteroid(
      asteroid.position.x + Math.cos(vAngle - angleOffset) * newRadius,
      asteroid.position.y + Math.sin(vAngle - angleOffset) * newRadius,
      Math.cos(vAngle - angleOffset) * newSpeed,
      Math.sin(vAngle - angleOffset) * newSpeed,
      newRadius,
    );

    // Apply cooldown to new asteroids
    a1.collisionCooldown = ASTEROID_SPLIT_COOLDOWN;
    a2.collisionCooldown = ASTEROID_SPLIT_COOLDOWN;

    state.entities.push(a1, a2);
  }
}

function createExplosion(
  state: GameState,
  x: number,
  y: number,
  count: number,
  isDramatic: boolean = false,
  rng: DeterministicRNG,
) {
  for (let i = 0; i < count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed =
      (isDramatic ? 100 : 50) + rng.next() * (isDramatic ? 300 : 150);
    state.particles.push({
      position: { x, y },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      color: rng.next() > 0.5 ? '#ffaa00' : '#ff3300',
      life: rng.range(isDramatic ? 1.0 : 0.5, isDramatic ? 3.0 : 1.5),
      size: rng.range(isDramatic ? 2 : 1, isDramatic ? 7 : 4),
    });
  }
}

function tryActivateAutoShield(
  state: GameState,
  ship: Entity,
  other: Entity,
  rng: DeterministicRNG,
): boolean {
  if (!ship.ownerId) return false;

  const boosters = state.playerBoosters[ship.ownerId] || [];
  const autoShield = boosters.find((b) => b.type === BoosterType.AutoShield);
  if (!autoShield || (autoShield.charges ?? 0) <= 0) return false;

  autoShield.charges = (autoShield.charges ?? 0) - 1;
  ship.isShieldActive = true;
  ship.invulnerabilityTimer = Math.max(ship.invulnerabilityTimer ?? 0, 0.5);

  const dx = ship.position.x - other.position.x;
  const dy = ship.position.y - other.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const surfaceDist = ship.radius + other.radius + 1;
  const speed = Math.max(120, Math.hypot(ship.velocity.x, ship.velocity.y));
  ship.position.x = other.position.x + nx * surfaceDist;
  ship.position.y = other.position.y + ny * surfaceDist;
  ship.velocity.x = nx * speed;
  ship.velocity.y = ny * speed;

  createExplosion(state, ship.position.x, ship.position.y, 10, false, rng);
  return true;
}

function createDeflectionParticles(
  x: number,
  y: number,
  color: string,
  rng: DeterministicRNG,
): {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  color: string;
  life: number;
  size: number;
}[] {
  const particles = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 + rng.next() * 0.15;
    const speed = rng.range(80, 200);
    particles.push({
      position: { x, y },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      color,
      life: rng.range(0.6, 1.0),
      size: rng.range(1, 3),
    });
  }
  return particles;
}
