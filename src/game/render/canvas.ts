import {
  Entity,
  EntityType,
  GameState,
  ShipClass,
  BoosterType,
  PlayerBooster,
} from '../engine/state';

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private shake: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D context');
    this.ctx = context;
  }

  public triggerShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  public render(state: GameState, localPlayerId: string) {
    this.ctx.save();

    // Hard reset of state to prevent cruft
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1.0;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Clear entire canvas regardless of scaling
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(
      -100,
      -100,
      state.worldWidth + 200,
      state.worldHeight + 200,
    );

    // Apply Screen Shake
    if (this.shake > 0) {
      const intensity = state.settings?.screenShake ?? 1.0;
      const sx = (Math.random() - 0.5) * this.shake * intensity;
      const sy = (Math.random() - 0.5) * this.shake * intensity;
      this.ctx.translate(sx, sy);
      this.shake *= 0.9;
      if (this.shake < 0.1) this.shake = 0;
    }

    // Strict Clip
    this.ctx.beginPath();
    this.ctx.rect(0, 0, state.worldWidth, state.worldHeight);
    this.ctx.clip();

    // Draw background and boundary
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, state.worldWidth, state.worldHeight);

    this.ctx.strokeStyle = '#111';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(0, 0, state.worldWidth, state.worldHeight);

    // Render Particles
    for (const p of state.particles) {
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(
        p.position.x - p.size / 2,
        p.position.y - p.size / 2,
        p.size,
        p.size,
      );
    }
    this.ctx.globalAlpha = 1.0;

    // Glow effects are expensive on older hardware, so we disable them by default for performance
    // this.ctx.shadowBlur = 10;

    for (const entity of state.entities) {
      this.drawEntity(entity, localPlayerId, state);
    }

    this.ctx.restore();
  }

  private drawEntity(entity: Entity, localPlayerId: string, state: GameState) {
    this.ctx.save();
    this.ctx.translate(entity.position.x, entity.position.y);
    this.ctx.rotate(entity.rotation);

    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';

    switch (entity.type) {
      case EntityType.Ship: {
        const stats = entity.stats!;
        const isLocal = entity.ownerId === localPlayerId;
        const color = isLocal ? stats.primaryColor : stats.secondaryColor;

        const active =
          (entity.ownerId ? state.playerBoosters[entity.ownerId] : []) || [];
        const isGhost = active.some(
          (b: PlayerBooster) => b.type === BoosterType.PhaseShift,
        );

        this.ctx.strokeStyle = color;
        this.ctx.shadowColor = color;

        if (isGhost) {
          this.ctx.globalAlpha = 0.5;
          this.ctx.setLineDash([4, 2]);
        }

        // Visual for Invulnerability
        if ((entity.invulnerabilityTimer ?? 0) > 0) {
          if (Math.floor(performance.now() / 100) % 2 === 0) {
            this.ctx.globalAlpha = 0.3;
          }
        }

        // Draw Shield Aura
        if (entity.isShieldActive) {
          this.ctx.save();
          this.ctx.strokeStyle = '#0066ff';
          this.ctx.shadowColor = '#0066ff';
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, entity.radius + 5, 0, Math.PI * 2);
          this.ctx.stroke();
          this.ctx.restore();
        }

        // Draw Engine Flame
        if (entity.isThrusting && Math.random() > 0.3) {
          this.ctx.save();
          this.ctx.strokeStyle = '#ff6600';
          this.ctx.shadowColor = '#ff6600';
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(-5, 0);
          this.ctx.lineTo(-15 - Math.random() * 10, 0);
          this.ctx.stroke();
          this.ctx.restore();
        }

        this.ctx.beginPath();
        if (entity.shipClass === ShipClass.Interceptor) {
          // Sleek Needle Design
          this.ctx.moveTo(12, 0);
          this.ctx.lineTo(-8, 5);
          this.ctx.lineTo(-4, 0);
          this.ctx.lineTo(-8, -5);
        } else if (entity.shipClass === ShipClass.Dreadnought) {
          // Blocky U-Shape Design
          this.ctx.moveTo(10, 8);
          this.ctx.lineTo(10, -8);
          this.ctx.lineTo(-5, -8);
          this.ctx.lineTo(-5, -3);
          this.ctx.lineTo(2, -3);
          this.ctx.lineTo(2, 3);
          this.ctx.lineTo(-5, 3);
          this.ctx.lineTo(-5, 8);
        } else {
          // Standard Triangle
          this.ctx.moveTo(10, 0);
          this.ctx.lineTo(-10, 8);
          this.ctx.lineTo(-5, 0);
          this.ctx.lineTo(-10, -8);
        }
        this.ctx.closePath();
        this.ctx.stroke();

        // Draw Energy Bar (reset rotation for bar)
        this.ctx.rotate(-entity.rotation);
        const energyWidth = 20;
        const energyHeight = 3;
        const energyFill = (entity.energy ?? 0) / (entity.maxEnergy ?? 100);
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(-energyWidth / 2, 15, energyWidth, energyHeight);
        this.ctx.fillStyle = energyFill > 0.3 ? '#00ff00' : '#ff0000';
        this.ctx.fillRect(
          -energyWidth / 2,
          15,
          energyWidth * energyFill,
          energyHeight,
        );
        break;
      }

      case EntityType.Projectile: {
        let color = entity.color || '#ff00ff';
        const owner = state.entities.find(
          (e) => e.type === EntityType.Ship && e.ownerId === entity.ownerId,
        );
        if (owner) {
          const isLocal = owner.ownerId === localPlayerId;
          const stats = owner.stats!;
          // Using primaryWeapon.projectileColor for local, secondaryWeapon.projectileColor for remote
          // This keeps the "primary color for me, secondary for them" logic consistent.
          color = isLocal
            ? stats.primaryWeapon.projectileColor
            : stats.secondaryWeapon.projectileColor;
        }

        this.ctx.fillStyle = color;
        this.ctx.shadowColor = color;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        this.ctx.fill();
        break;
      }

      case EntityType.Planet: {
        const hueShift = Math.sin(state.tick * 0.05) * 10;
        this.ctx.fillStyle = `hsl(${220 + hueShift}, 40%, 30%)`;
        this.ctx.shadowColor = `hsl(${220 + hueShift}, 50%, 50%)`;
        this.ctx.shadowBlur = 15;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        this.ctx.fill();
        // Surface rings/details
        this.ctx.strokeStyle = `rgba(255,255,255,0.1)`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius * 0.8, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;
        break;
      }

      case EntityType.SpaceStorm: {
        const flicker = 0.1 + Math.random() * 0.2;
        this.ctx.globalAlpha = flicker;
        this.ctx.fillStyle = `rgba(150, 0, 255, 1.0)`;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        this.ctx.fill();

        // Rotating lightning core
        this.ctx.save();
        this.ctx.rotate(state.tick * 0.05);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.globalAlpha = 1.0;
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          this.ctx.beginPath();
          this.ctx.moveTo(0, 0);
          this.ctx.lineTo(
            Math.cos(angle) * entity.radius,
            Math.sin(angle) * entity.radius,
          );
          this.ctx.stroke();
        }
        this.ctx.restore();
        this.ctx.globalAlpha = 1.0;
        break;
      }

      case EntityType.SpaceSnake:
        this.ctx.fillStyle = '#ff3300';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        this.ctx.fill();
        break;

      case EntityType.GravityWell: {
        const isPush = entity.gravityMode === 'push';
        const pulse = 0.7 + Math.sin(state.tick * 0.1) * 0.3;
        const color = isPush ? '#ff3300' : '#9900ff';
        const shadow = isPush ? '#ff6600' : '#cc00ff';

        this.ctx.strokeStyle = color;
        this.ctx.shadowColor = shadow;
        this.ctx.shadowBlur = 10 * pulse;
        this.ctx.lineWidth = 1;

        // Draw multiple rings pulsating
        const timeOffset = state.tick * 0.02;
        for (let i = 0; i < 3; i++) {
          let ringScale = (timeOffset + i / 3) % 1;
          if (isPush) ringScale = 1 - ringScale; // Expand out for push

          const ringRadius = entity.radius * (1 - ringScale);
          this.ctx.globalAlpha = 1 - ringScale;
          this.ctx.beginPath();
          this.ctx.arc(0, 0, Math.max(1, ringRadius), 0, Math.PI * 2);
          this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1.0;

        // Draw core with rotating detail
        this.ctx.fillStyle = isPush ? '#330000' : '#110033';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius * 0.2, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.save();
        this.ctx.rotate(isPush ? state.tick * 0.04 : -state.tick * 0.04);
        this.ctx.strokeStyle = isPush ? '#ffaa00' : '#00ffcc';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, entity.radius * 0.25, 0, Math.PI * 0.5);
        this.ctx.stroke();
        this.ctx.restore();
        break;
      }
      case EntityType.Asteroid:
        this.ctx.strokeStyle = '#ffaa00';
        this.ctx.shadowColor = '#ffaa00';
        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const x = Math.cos(angle) * entity.radius;
          const y = Math.sin(angle) * entity.radius;
          if (i === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
        }
        this.ctx.closePath();
        this.ctx.stroke();
        break;

      case EntityType.Saucer:
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.shadowColor = '#ff0000';
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, 15, 6, 0, 0, Math.PI * 2);
        this.ctx.moveTo(-8, -4);
        this.ctx.lineTo(8, -4);
        this.ctx.stroke();
        break;

      case EntityType.Booster: {
        const color = entity.color || '#fff';
        this.ctx.strokeStyle = color;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 15;
        this.ctx.lineWidth = 3;

        const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.2;
        this.ctx.scale(pulse, pulse);

        this.ctx.beginPath();
        if (entity.boosterType === 'infinityCapacitor') {
          // Infinity Symbol (simplified as two circles or figure 8)
          this.ctx.arc(-4, 0, 5, 0, Math.PI * 2);
          this.ctx.moveTo(9, 0);
          this.ctx.arc(4, 0, 5, 0, Math.PI * 2);
        } else if (entity.boosterType === BoosterType.VectorTorpedo) {
          // Long triangle
          this.ctx.moveTo(8, 0);
          this.ctx.lineTo(-8, 5);
          this.ctx.lineTo(-4, 0);
          this.ctx.lineTo(-8, -5);
          this.ctx.closePath();
        } else if (entity.boosterType === BoosterType.PhaseShift) {
          // Dashed circle / Ghost icon
          this.ctx.setLineDash([2, 2]);
          this.ctx.arc(0, 0, 8, 0, Math.PI * 2);
        } else if (entity.boosterType === BoosterType.EMPBlast) {
          // Diamond / Pulse icon
          this.ctx.moveTo(0, -8);
          this.ctx.lineTo(8, 0);
          this.ctx.lineTo(0, 8);
          this.ctx.lineTo(-8, 0);
          this.ctx.closePath();
        } else if (entity.boosterType === BoosterType.GravityAnchor) {
          // Anchor shape (simplified)
          this.ctx.moveTo(0, -8);
          this.ctx.lineTo(0, 8);
          this.ctx.moveTo(-6, 4);
          this.ctx.lineTo(6, 4);
          this.ctx.arc(0, 4, 6, 0, Math.PI);
        } else if (entity.boosterType === BoosterType.ExtraLife) {
          // Heart shape
          this.ctx.moveTo(0, 3);
          this.ctx.bezierCurveTo(-5, -2, -10, -5, 0, -8);
          this.ctx.bezierCurveTo(10, -5, 5, -2, 0, 3);
        } else if (entity.boosterType === BoosterType.AutoShield) {
          // Shield arc
          this.ctx.moveTo(-8, -1);
          this.ctx.lineTo(-8, 3);
          this.ctx.arc(0, 1, 8, Math.PI, 0);
          this.ctx.lineTo(8, -1);
        } else {
          this.ctx.rect(-6, -6, 12, 12);
        }
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset dash
        break;
      }
    }

    this.ctx.restore();
  }
}
