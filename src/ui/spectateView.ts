/**
 * SpectateView — renders the game from a spectator perspective.
 *
 * Receives lightweight SpectateState from the server-peer spectate room
 * and renders ships, projectiles, and score overlay on the game canvas.
 */

import type {
  SpectateState,
  SpectateEvent,
  SpectateShip,
} from '../network/spectateClient';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../game/engine/worldConfig';

export class SpectateView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: SpectateState | null = null;
  private element: HTMLDivElement;
  private running = false;
  private animFrame = 0;

  public onLeave?: () => void;

  constructor(canvas: HTMLCanvasElement, parent: HTMLElement) {
    this.canvas = canvas;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('No 2d context');
    this.ctx = c;

    this.element = document.createElement('div');
    this.element.className = 'ui-element';
    this.element.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; display: none; z-index: 1050;
    `;
    parent.appendChild(this.element);
  }

  show(): void {
    this.element.style.display = 'block';
    this.canvas.style.display = 'block';
    this.running = true;
    this.render();
  }
  hide(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrame);
    this.element.style.display = 'none';
    this.state = null;
  }

  onState(s: SpectateState): void {
    this.state = s;
    this.updateOverlay(s);
  }
  onGameOver(_e: SpectateEvent): void {
    if (this.element)
      this.element.innerHTML +=
        '<div style="position: absolute; top: 30%; left: 50%; transform: translateX(-50%); pointer-events: none; font-size: 28px; color: #ffaa00; text-shadow: 0 0 10px #ffaa00;">MATCH OVER</div>';
  }

  private updateOverlay(s: SpectateState): void {
    const p1 = Object.keys(s.playerCallSigns)[0]!;
    const p2 = Object.keys(s.playerCallSigns)[1]!;
    const n1 = s.playerCallSigns[p1!] ?? 'P1';
    const n2 = s.playerCallSigns[p2!] ?? 'P2';
    const s1 = s.score[p1!] ?? 0;
    const s2 = s.score[p2!] ?? 0;
    const l1 = s.lives[p1!] ?? 0;
    const l2 = s.lives[p2!] ?? 0;

    this.element.innerHTML = `
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; color: #fff; font-size: 13px;">
        <div><span style="color: #00ffcc;">${n1}</span> ${s1} ${'❤️'.repeat(l1)}</div>
        <div style="color: #ff00ff; font-size: 14px;">WAVE ${s.wave} ${s.isPaused ? '⏸' : ''}</div>
        <div><span style="color: #ffaa00;">${n2}</span> ${s2} ${'❤️'.repeat(l2)}</div>
      </div>
      <div style="position: absolute; top: 4px; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.3); font-size: 10px;">👁 SPECTATING</div>
      <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); pointer-events: auto;">
        <button id="btn-spectate-leave" style="padding: 8px 20px; background: rgba(0,0,0,0.7); color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;">LEAVE</button>
      </div>
    `;

    const btn = this.element.querySelector('#btn-spectate-leave');
    if (btn) btn.addEventListener('click', () => this.onLeave?.());
  }

  private render(): void {
    if (!this.running) return;
    const s = this.state;
    const ctx = this.ctx;

    // Clear
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    if (!s) {
      this.animFrame = requestAnimationFrame(() => this.render());
      return;
    }

    const scaleX = this.canvas.width / WORLD_WIDTH;
    const scaleY = this.canvas.height / WORLD_HEIGHT;
    ctx.save();
    ctx.scale(scaleX, scaleY);

    // Draw ships
    for (const ship of s.ships) {
      this.drawShip(ctx, ship);
    }

    // Draw projectiles
    for (const p of s.projectiles) {
      ctx.fillStyle = p.color || '#ff00ff';
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    this.animFrame = requestAnimationFrame(() => this.render());
  }

  private drawShip(ctx: CanvasRenderingContext2D, ship: SpectateShip): void {
    ctx.save();
    ctx.translate(ship.position.x, ship.position.y);
    ctx.rotate(ship.rotation);

    const color = ship.color || '#00ffcc';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = ship.isShieldActive ? 12 : 6;
    ctx.shadowColor = color;

    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, -6);
    ctx.closePath();
    ctx.stroke();

    // Thrust flame
    if (ship.isThrusting) {
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#ff6600';
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(-14 + Math.random() * 4, 0);
      ctx.lineTo(-5, 3);
      ctx.stroke();
    }

    ctx.restore();
  }
}
