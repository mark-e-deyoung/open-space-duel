import {
  GameState,
  PlayerInput,
  EntityType,
  ShipClass,
  WeaponConfig,
  BoosterType,
  Entity,
} from '../engine/state';
import { DeterministicRNG } from '../../sim/prng';
import { MAX_PARTICLES, MAX_ENTITIES } from '../engine/worldConfig';
import { createProjectile } from '../entities/projectile';
import { createAsteroid } from '../entities/asteroid';
import { createShip } from '../entities/ship';
import { createGravityWell } from '../entities/gravityWell';
import { createPlanet } from '../entities/planet';
import { createSpaceStorm } from '../entities/spaceStorm';
import { createSpaceSnake } from '../entities/spaceSnake';
import { createSaucer } from '../entities/saucer';
import { createBooster, updateBoosters } from '../entities/booster';

const DRAG = 0.99; // Apply some drag per frame
const BOOSTER_DIFFICULTY_CONFIG = {
  rare: { max: 1, baseInterval: 45 },
  normal: { max: 3, baseInterval: 25 },
  chaos: { max: 8, baseInterval: 10 },
};

export function updatePhysics(
  state: GameState,
  inputs: { [playerId: string]: PlayerInput },
  dt: number,
  onSound?: (
    type: 'thrust' | 'fire' | 'shield' | 'depleted' | 'respawn' | 'emp',
  ) => void,
) {
  if (state.isPaused || state.isGameOver) return;

  state.tick++;

  // Seeded PRNG for deterministic simulation
  const rng = new DeterministicRNG(state.prngState);

  // 1. Dynamic Booster Spawning (Host only)
  if (state.settings.boostersEnabled) {
    const rateConfig =
      BOOSTER_DIFFICULTY_CONFIG[state.settings.boosterRate] ||
      BOOSTER_DIFFICULTY_CONFIG.normal;
    const activeBoosters = state.entities.filter(
      (e) => e.type === EntityType.Booster && e.isActive,
    ).length;

    if (activeBoosters < rateConfig.max) {
      // Calculate player activity (avg velocity magnitude)
      const ships = state.entities.filter(
        (e) => e.type === EntityType.Ship && e.isActive,
      );
      let totalVelocity = 0;
      ships.forEach((s) => {
        totalVelocity += Math.sqrt(
          s.velocity.x * s.velocity.x + s.velocity.y * s.velocity.y,
        );
      });
      const avgVelocity = ships.length > 0 ? totalVelocity / ships.length : 0;

      // The more active they are, the LONGER the cooldown.
      const activityFactor = Math.min(2.0, avgVelocity / 100);
      const spawnCooldown = rateConfig.baseInterval * (0.5 + activityFactor);

      if (state.tick - state.lastBoosterSpawnTick > spawnCooldown / dt) {
        state.lastBoosterSpawnTick = state.tick;
        const types = Object.values(BoosterType);
        let type = types[rng.rangeInt(0, types.length - 1)]!;

        // Rare check for Extra Life
        if (type === BoosterType.ExtraLife && rng.next() > 0.1) {
          // Re-roll to a non-rare type if 10% chance failed
          const commonTypes = types.filter((t) => t !== BoosterType.ExtraLife);
          type = commonTypes[rng.rangeInt(0, commonTypes.length - 1)]!;
        }

        state.entities.push(
          createBooster(
            rng.next() * state.worldWidth,
            rng.next() * state.worldHeight,
            type,
          ),
        );
      }
    }
  }

  // Update physical entities (Boosters rotation/velocity)
  updateBoosters(state.entities, dt);

  // Update active boosters durations/charges
  if (!state.playerBoosters) state.playerBoosters = {};
  for (const pId in state.playerBoosters) {
    state.playerBoosters[pId!] = (state.playerBoosters[pId!] ?? []).filter(
      (b) => {
        if (b.remainingDuration !== undefined) {
          b.remainingDuration -= dt;
          return b.remainingDuration > 0;
        }
        if (b.charges !== undefined) {
          return b.charges > 0;
        }
        return false;
      },
    );
  }

  // Cap entities before adding more
  if (state.entities.length > MAX_ENTITIES) {
    const projectiles = state.entities.filter(
      (e) => e.type === EntityType.Projectile,
    );
    if (projectiles.length > MAX_ENTITIES / 2) {
      const toDrop = new Set(
        projectiles
          .slice(0, Math.floor(projectiles.length / 2))
          .map((p) => p.id),
      );
      state.entities = state.entities.filter((e) => !toDrop.has(e.id));
    }
  }

  // Update Particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i]!;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;

    if (p.position.x < 0) p.position.x += state.worldWidth;
    else if (p.position.x > state.worldWidth) p.position.x -= state.worldWidth;
    if (p.position.y < 0) p.position.y += state.worldHeight;
    else if (p.position.y > state.worldHeight)
      p.position.y -= state.worldHeight;

    p.life -= dt * 2.5;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
    }
  }
  if (state.particles.length > MAX_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_PARTICLES);
  }

  const newProjectiles: Entity[] = [];
  let asteroidCount = 0;

  for (const entity of state.entities) {
    if (entity.type === EntityType.Asteroid) {
      asteroidCount++;
    }
    if (!entity.isActive) continue;

    // Apply player input if this is a ship owned by a player
    if (
      entity.type === EntityType.Ship &&
      entity.ownerId &&
      inputs[entity.ownerId]
    ) {
      const input = inputs[entity.ownerId!]!;
      const stats = entity.stats!;
      const active = state.playerBoosters[entity.ownerId] || [];

      // Energy Recharge
      if (
        entity.energy !== undefined &&
        entity.maxEnergy !== undefined &&
        !entity.isShieldActive
      ) {
        const rechargeRate =
          stats.rechargeRate * (entity.isThrusting ? 0.5 : 1.0);
        entity.energy = Math.min(
          entity.maxEnergy,
          entity.energy + rechargeRate * dt,
        );
      }

      // Infinity Capacitor: Lock energy at max
      if (active.some((b) => b.type === BoosterType.InfinityCapacitor)) {
        entity.energy = entity.maxEnergy;
      }

      // Gravity Anchor: Kill momentum
      if (active.some((b) => b.type === BoosterType.GravityAnchor)) {
        entity.velocity.x = 0;
        entity.velocity.y = 0;
      }

      const hasEnergy = (entity.energy ?? 0) > 0;
      const torpedoBooster = active.find(
        (b) => b.type === BoosterType.VectorTorpedo && (b.charges ?? 0) > 0,
      );

      if (input.targetRotation !== undefined) {
        let diff = input.targetRotation - entity.rotation;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const step = stats.rotationSpeed * dt;
        if (Math.abs(diff) < step) entity.rotation = input.targetRotation;
        else entity.rotation += Math.sign(diff) * step;
      } else {
        if (input.left) entity.rotation -= stats.rotationSpeed * dt;
        if (input.right) entity.rotation += stats.rotationSpeed * dt;
      }

      entity.isShieldActive = input.shield && (entity.energy ?? 0) > 5;
      if (entity.isShieldActive) {
        entity.energy = Math.max(
          0,
          (entity.energy ?? 0) - stats.shieldCost * dt,
        );
        if (state.tick % 5 === 0) onSound?.('shield');
      }

      entity.isThrusting = input.thrust && hasEnergy && !entity.isShieldActive;
      if (entity.isThrusting) {
        entity.velocity.x +=
          Math.cos(entity.rotation) * stats.acceleration * dt;
        entity.velocity.y +=
          Math.sin(entity.rotation) * stats.acceleration * dt;
        entity.energy = Math.max(
          0,
          (entity.energy ?? 0) - stats.thrustCost * dt,
        );
        if (state.tick % 5 === 0) onSound?.('thrust');
        if (state.tick % 2 === 0) {
          state.particles.push({
            position: { ...entity.position },
            velocity: {
              x: -Math.cos(entity.rotation) * 50 + (rng.next() - 0.5) * 20,
              y: -Math.sin(entity.rotation) * 50 + (rng.next() - 0.5) * 20,
            },
            color: stats.primaryColor,
            life: 1.0,
            size: 2,
          });
        }
      }

      if ((entity.primaryCooldown ?? 0) > 0) entity.primaryCooldown! -= dt;
      if ((entity.secondaryCooldown ?? 0) > 0) entity.secondaryCooldown! -= dt;

      // Final Override for Infinity Capacitor
      if (active.some((b) => b.type === BoosterType.InfinityCapacitor)) {
        entity.energy = entity.maxEnergy;
      }

      const fireWeapon = (config: WeaponConfig, isPrimary: boolean) => {
        if (
          (entity.energy ?? 0) >= config.fireCost &&
          (isPrimary
            ? (entity.primaryCooldown ?? 0)
            : (entity.secondaryCooldown ?? 0)) <= 0
        ) {
          entity.energy = (entity.energy ?? 0) - config.fireCost;
          if (isPrimary) entity.primaryCooldown = config.cooldown;
          else entity.secondaryCooldown = config.cooldown;

          let pSpeed = config.projectileSpeed;
          let pRadius = config.projectileRadius;
          let pLife = config.projectileLife;
          let pColor = config.projectileColor;
          const pRadiusGrowth =
            entity.shipClass === ShipClass.Dreadnought
              ? isPrimary
                ? 0.3
                : 0.25
              : 0;

          if (torpedoBooster) {
            pSpeed *= 1.5;
            pRadius *= 2;
            pLife *= 1.2;
            pColor = '#ffffff';
            torpedoBooster.charges! -= 1;
          }

          const spawnShot = (angleOffset: number = 0) => {
            const angle = entity.rotation + angleOffset;
            const px =
              entity.position.x + Math.cos(angle) * (entity.radius + 2);
            const py =
              entity.position.y + Math.sin(angle) * (entity.radius + 2);
            newProjectiles.push(
              createProjectile(
                px,
                py,
                angle,
                entity.ownerId!,
                pSpeed,
                pLife,
                pRadius,
                pColor,
                pRadiusGrowth,
              ),
            );
          };

          // Handle weapon types
          if (config.type === 'triple') {
            spawnShot(-0.2);
            spawnShot(0);
            spawnShot(0.2);
          } else if (config.type === 'burst') {
            spawnShot(0);
            spawnShot((rng.next() - 0.5) * 0.1);
          } else {
            spawnShot(0);
          }

          onSound?.('fire');
        }
      };

      if (input.fire) fireWeapon(stats.primaryWeapon, true);
      if (input.fireSecondary) fireWeapon(stats.secondaryWeapon, false);

      // ABSOLUTE FINAL OVERRIDE: Infinity Capacitor (Must happen after ALL consumption)
      if (active.some((b) => b.type === BoosterType.InfinityCapacitor)) {
        entity.energy = entity.maxEnergy;
      }
    }

    if (entity.type === EntityType.Ship) {
      entity.velocity.x *= DRAG;
      entity.velocity.y *= DRAG;

      if ((entity.invulnerabilityTimer ?? 0) > 0) {
        entity.invulnerabilityTimer! -= dt;
      }
    }

    if (entity.type === EntityType.SpaceSnake) {
      const segments = state.entities.filter(
        (e) => e.type === EntityType.SpaceSnake && e.ownerId === entity.ownerId,
      );
      const head = segments[0];

      if (entity.id === head?.id) {
        // Head logic
        if (!entity.snakeState) entity.snakeState = 'hunting';
        if (entity.snakeTimer === undefined) entity.snakeTimer = 0;

        const ships = state.entities.filter(
          (e) => e.type === EntityType.Ship && e.isActive,
        );

        if (entity.snakeState === 'hunting') {
          if (ships.length > 0) {
            let nearest = ships[0];
            let minDist = Infinity;
            for (const ship of ships) {
              const dx = ship.position.x - entity.position.x;
              const dy = ship.position.y - entity.position.y;
              const d = dx * dx + dy * dy;
              if (d < minDist) {
                minDist = d;
                nearest = ship;
              }
            }

            const dx = nearest!.position.x - entity.position.x;
            const dy = nearest!.position.y - entity.position.y;
            const targetAngle = Math.atan2(dy, dx);

            let angleDiff = targetAngle - entity.rotation;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            entity.rotation += angleDiff * 2 * dt;
            const speed = 120 + state.wave * 5;
            entity.velocity.x = Math.cos(entity.rotation) * speed;
            entity.velocity.y = Math.sin(entity.rotation) * speed;

            // Transition logic: Low probability of strike or rest
            if (state.tick % 60 === 0) {
              const rand = rng.next();
              if (rand < 0.05 && minDist < 400 * 400) {
                entity.snakeState = 'coiling';
                entity.snakeTimer = 1.0; // Coil for 1 second
              } else if (rand > 0.95) {
                entity.snakeState = 'resting';
                entity.snakeTimer = 3.0; // Rest for 3 seconds
              }
            }
          }
        } else if (entity.snakeState === 'coiling') {
          entity.snakeTimer -= dt;
          entity.velocity.x *= 0.9; // Slow down to "hunch up"
          entity.velocity.y *= 0.9;

          if (entity.snakeTimer <= 0) {
            entity.snakeState = 'striking';
            entity.snakeTimer = 0.5; // Strike for 0.5 seconds
            onSound?.('emp'); // Dramatic sound for strike
          }
        } else if (entity.snakeState === 'striking') {
          entity.snakeTimer -= dt;
          const strikeSpeed = 400 + state.wave * 10;
          entity.velocity.x = Math.cos(entity.rotation) * strikeSpeed;
          entity.velocity.y = Math.sin(entity.rotation) * strikeSpeed;

          if (entity.snakeTimer <= 0) {
            entity.snakeState = 'hunting';
          }
        } else if (entity.snakeState === 'resting') {
          entity.snakeTimer -= dt;
          entity.velocity.x *= 0.8;
          entity.velocity.y *= 0.8;

          if (entity.snakeTimer <= 0) {
            entity.snakeState = 'hunting';
          }
        }
      } else {
        // Body logic: follow segment in front
        const idx = segments.findIndex((s) => s.id === entity.id);
        const leader = segments[idx - 1];
        if (leader) {
          const dx = leader.position.x - entity.position.x;
          const dy = leader.position.y - entity.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Advanced following: hunch up if leader is coiling, or curl if resting
          let minFollowDist = entity.radius * 1.5;
          if (head!.snakeState === 'coiling') {
            minFollowDist = entity.radius * 0.8; // Hunch up
          } else if (head!.snakeState === 'resting') {
            // Circle/curl around leader
            const angle = Math.atan2(dy, dx) + dt * 2;
            entity.position.x =
              leader.position.x - Math.cos(angle) * minFollowDist;
            entity.position.y =
              leader.position.y - Math.sin(angle) * minFollowDist;
            entity.rotation = angle;
            return; // Skip standard following
          }

          if (dist > minFollowDist) {
            const angle = Math.atan2(dy, dx);
            const moveDist = dist - minFollowDist;
            entity.position.x += Math.cos(angle) * moveDist;
            entity.position.y += Math.sin(angle) * moveDist;
            entity.rotation = angle;
          }
        }
      }
    }

    if (entity.type === EntityType.Saucer) {
      if (rng.next() < 0.01) entity.velocity.y = (rng.next() - 0.5) * 100;
      if (rng.next() < 0.005) {
        const players = state.entities.filter(
          (e) => e.type === EntityType.Ship && e.isActive,
        );
        if (players.length > 0) {
          const target = players[rng.rangeInt(0, players.length - 1)];
          const dx = target!.position.x - entity.position.x;
          const dy = target!.position.y - entity.position.y;
          const angle = Math.atan2(dy, dx);
          const px = entity.position.x + Math.cos(angle) * (entity.radius + 5);
          const py = entity.position.y + Math.sin(angle) * (entity.radius + 5);
          newProjectiles.push(createProjectile(px, py, angle, entity.id));
        }
      }
    }

    if (
      entity.gravityCooldown !== undefined &&
      entity.type === EntityType.GravityWell
    ) {
      entity.gravityCooldown -= dt;
      if (entity.gravityCooldown <= 0) {
        entity.gravityMode = entity.gravityMode === 'pull' ? 'push' : 'pull';
        entity.gravityCooldown = 5 + rng.next() * 5;
      }
    }

    if (
      entity.type !== EntityType.GravityWell &&
      entity.type !== EntityType.Planet
    ) {
      const isShip = entity.type === EntityType.Ship;
      if (isShip && entity.ownerId) {
        const active = state.playerBoosters[entity.ownerId] || [];
        if (active.some((b) => b.type === BoosterType.GravityAnchor)) continue;
      }

      for (const source of state.entities) {
        if (
          (source.type === EntityType.GravityWell ||
            source.type === EntityType.Planet) &&
          source.isActive
        ) {
          let dx = source.position.x - entity.position.x;
          let dy = source.position.y - entity.position.y;
          if (Math.abs(dx) > state.worldWidth / 2)
            dx -= Math.sign(dx) * state.worldWidth;
          if (Math.abs(dy) > state.worldHeight / 2)
            dy -= Math.sign(dy) * state.worldHeight;
          const distSq = dx * dx + dy * dy;
          const maxDistSq =
            source.type === EntityType.GravityWell ? 160000 : 90000;
          if (distSq > 100 && distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            let bForce =
              source.type === EntityType.GravityWell ? 150000 : 75000;
            if (source.type === EntityType.GravityWell)
              bForce *= 0.8 + Math.sin(state.tick * 0.05) * 0.4;
            const mFactor = isShip ? 2 : 12.0;
            const direction =
              source.type === EntityType.GravityWell &&
              source.gravityMode === 'push'
                ? -1
                : 1;
            const force = (bForce * mFactor * direction) / distSq;
            entity.velocity.x += (dx / dist) * force * dt;
            entity.velocity.y += (dy / dist) * force * dt;
          }
        }
      }
    }

    entity.position.x += entity.velocity.x * dt;
    entity.position.y += entity.velocity.y * dt;
    if (entity.position.x < 0) entity.position.x += state.worldWidth;
    else if (entity.position.x > state.worldWidth)
      entity.position.x -= state.worldWidth;
    if (entity.position.y < 0) entity.position.y += state.worldHeight;
    else if (entity.position.y > state.worldHeight)
      entity.position.y -= state.worldHeight;

    if (
      entity.type === EntityType.Projectile &&
      entity.lifeTime !== undefined
    ) {
      entity.lifeTime -= dt;
      if (
        entity.initialRadius !== undefined &&
        entity.radiusGrowthFactor !== undefined
      ) {
        const lifeElapsed =
          (entity.initialLifeTime ?? entity.lifeTime) - entity.lifeTime;
        const growth = Math.max(0, entity.radiusGrowthFactor * lifeElapsed);
        entity.radius = entity.initialRadius * (1 + growth);
      }
      if (entity.lifeTime <= 0) entity.isActive = false;
    }
    if (entity.collisionCooldown !== undefined && entity.collisionCooldown > 0)
      entity.collisionCooldown -= dt;
    if (
      entity.environmentCooldown !== undefined &&
      entity.environmentCooldown > 0
    )
      entity.environmentCooldown -= dt;
  }

  if (newProjectiles.length > 0) state.entities.push(...newProjectiles);

  if (asteroidCount === 0 && state.entities.length > 0) {
    if (
      state.entities.some((e) => e.type === EntityType.Ship) &&
      state.tick > 10
    ) {
      state.wave++;

      // Clear player boosters on wave transition
      state.playerBoosters = {};

      state.entities = state.entities.filter(
        (e) =>
          e.type !== EntityType.GravityWell &&
          e.type !== EntityType.Planet &&
          e.type !== EntityType.SpaceStorm &&
          e.type !== EntityType.Saucer &&
          e.type !== EntityType.SpaceSnake &&
          e.type !== EntityType.Booster,
      );
      if (state.settings.hazardsEnabled) {
        const waveMod = state.wave % 3;
        if (waveMod === 1)
          state.entities.push(
            createGravityWell(
              state.worldWidth / 2,
              state.worldHeight / 2,
              80 + rng.next() * 40,
            ),
          );
        else if (waveMod === 2) {
          state.entities.push(
            createPlanet(state.worldWidth / 2, state.worldHeight / 2, 80),
          );
          state.entities.push(
            createSpaceStorm(
              state.worldWidth * 0.25,
              state.worldHeight / 2,
              100,
            ),
            createSpaceStorm(
              state.worldWidth * 0.75,
              state.worldHeight / 2,
              100,
            ),
          );
        } else
          state.entities.push(
            createSaucer(
              rng.next() * state.worldWidth,
              rng.next() * state.worldHeight,
            ),
          );
        if (state.wave % 4 === 0)
          state.entities.push(
            ...createSpaceSnake(
              rng.next() * state.worldWidth,
              rng.next() * state.worldHeight,
              15,
              10,
              rng.next() * Math.PI * 2,
            ),
          );
      }
      const baseCount = Math.floor(state.settings.asteroidDensity * 1.5);
      for (let i = 0; i < baseCount + state.wave; i++) {
        state.entities.push(
          createAsteroid(
            rng.next() * state.worldWidth,
            rng.next() * state.worldHeight,
            (rng.next() - 0.5) * 100 * (1 + state.wave * 0.1),
            (rng.next() - 0.5) * 100 * (1 + state.wave * 0.1),
            20,
          ),
        );
      }
    }
  }

  const ships = state.entities.filter(
    (e) => e.type === EntityType.Ship && e.isActive,
  );

  const playerIds = Object.keys(state.lives);
  let aliveCount = 0;

  for (const pId of playerIds) {
    if ((state.lives[pId!] ?? 0) > 0) {
      aliveCount++;
      const hasShip = ships.some((e) => e.ownerId === pId);
      if (!hasShip) {
        const idx = playerIds.indexOf(pId);
        const x =
          playerIds.length > 1
            ? idx === 0
              ? 100
              : state.worldWidth - 100
            : state.worldWidth / 2;

        const custom = state.playerCustomizations[pId];
        state.entities.push(
          createShip(
            x,
            state.worldHeight / 2,
            pId,
            state.playerShipClasses[pId] || ShipClass.Standard,
            undefined,
            custom,
          ),
        );
        onSound?.('respawn');
      }
    }
  }

  const isMatchOver = playerIds.length > 1 ? aliveCount <= 1 : aliveCount === 0;

  if (isMatchOver && playerIds.length > 0) {
    if (state.gameOverCountdown === undefined) state.gameOverCountdown = 3.0; // reduced for faster pacing
    state.gameOverCountdown -= dt;
    if (state.gameOverCountdown <= 0) state.isGameOver = true;
  } else state.gameOverCountdown = undefined;

  // Save PRNG state for next tick
  state.prngState = rng.currentState;

  state.entities = state.entities.filter((e) => e.isActive);
}
