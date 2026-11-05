import { GameState, EntityType } from '../game/engine/state';

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

interface FullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
}

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

export class HUD {
  private element: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ui-element';
    this.element.setAttribute('data-testid', 'hud');
    this.element.style.cssText = `
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
      padding: 20px;
      font-size: 20px;
      font-weight: bold;
      color: #fff;
      display: none;
    `;
    parent.appendChild(this.element);
  }

  public show() {
    this.element.style.display = 'flex';
  }

  public hide() {
    this.element.style.display = 'none';
  }

  public update(
    state: GameState,
    localPlayerId: string,
    remotePlayerId: string | null,
    soundEnabled: boolean = true,
    onSoundToggle?: () => void,
    onTaunt?: (emoji: string) => void,
    /** True for local multiplayer — shows P2 energy bar, hides taunts. */
    isLocalMultiplayer: boolean = false,
  ) {
    const localShip = state.entities.find(
      (e) =>
        e.type === EntityType.Ship && e.ownerId === localPlayerId && e.isActive,
    );
    const remoteShip = remotePlayerId
      ? state.entities.find(
          (e) =>
            e.type === EntityType.Ship &&
            e.ownerId === remotePlayerId &&
            e.isActive,
        )
      : null;

    // ── Top bar ──────────────────────────────────────────────────
    let html =
      '<div style="display: flex; justify-content: space-between; width: 100%; pointer-events: none;">';

    // Player 1 stats
    html += this.playerPanel(
      localPlayerId,
      state,
      localShip ?? null,
      '#00ffcc',
    );

    // Wave indicator
    html += `<div style="text-align: center; color: #ff00ff; font-size: 14px;" data-testid="wave-display">
      WAVE ${state.wave}
      <div style="font-size: 10px; color: #888;">${state.isPaused ? '⏸ PAUSED' : ''}</div>
    </div>`;

    // Player 2 / opponent stats
    if (remotePlayerId) {
      html += this.playerPanel(
        remotePlayerId,
        state,
        remoteShip ?? null,
        '#ffaa00',
      );
    } else {
      html += '<div></div>';
    }

    html += '</div>';

    // ── Energy bars ─────────────────────────────────────────────
    if (isLocalMultiplayer) {
      // Local duel: show energy bars for both players
      html += this.energyBar(localShip ?? null, '#00ffcc', 'left: 20px;');
      html += this.energyBar(remoteShip ?? null, '#ffaa00', 'right: 20px;');
    } else if (localShip?.stats) {
      html += this.energyBar(
        localShip ?? null,
        '#00ffcc',
        'left: 50%; transform: translateX(-50%);',
      );
    }

    // ── Pause overlay ────────────────────────────────────────────
    if (state.isPaused) {
      html += `<div style="display: flex; flex: 1; align-items: center; justify-content: center; pointer-events: none;">
        <h1 style="color: #00ffcc; font-size: 48px; text-shadow: 0 0 20px #00ffcc;" data-testid="paused-banner">PAUSED</h1>
      </div>`;
    }

    // ── Taunt bar (networked duels only — no taunts in local/survival) ────
    if (remotePlayerId && onTaunt && !isLocalMultiplayer) {
      const taunts = [
        { id: '💀', title: 'Threat' },
        { id: '😎', title: 'Mock' },
        { id: '👏', title: 'Respect' },
        { id: '😱', title: 'Surprise' },
      ];
      html +=
        '<div style="position: absolute; bottom: 50px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; gap: 6px; z-index: 1100;">';
      for (const t of taunts) {
        html += `<button class="hud-taunt-btn" data-taunt="${t.id}" data-testid="taunt-btn-${t.id}" style="background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 4px 8px; min-width: 44px; min-height: 44px; box-sizing: border-box; cursor: pointer; border-radius: 4px; font-size: 18px; transition: border-color 0.2s;" title="${t.title}">${t.id}</button>`;
      }
      html += '</div>';
    }

    // ── Sound toggle (top right) ─────────────────────────────────
    html += `
      <div style="position: absolute; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); pointer-events: auto;">
        <button id="hud-sound-btn" data-testid="hud-sound-btn" style="background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #fff; padding: 5px 8px; min-width: 44px; min-height: 44px; box-sizing: border-box; cursor: pointer; border-radius: 4px; font-size: 14px;">${soundEnabled ? '🔊' : '🔇'}</button>
      </div>
    `;

    // ── Fullscreen button ────────────────────────────────────────
    if (this.supportsFullscreen()) {
      html += `
        <div style="position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); pointer-events: auto;">
          <button id="fullscreen-btn" data-testid="fullscreen-btn" style="background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #fff; padding: 5px 10px; min-width: 44px; min-height: 44px; box-sizing: border-box; cursor: pointer; font-size: 12px;">FULLSCREEN</button>
        </div>
      `;
    }

    this.element.innerHTML = html;

    // Wire taunt buttons
    if (onTaunt) {
      this.element.querySelectorAll('.hud-taunt-btn').forEach((btn) => {
        (btn as HTMLButtonElement).onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const emoji = btn.getAttribute('data-taunt');
          if (emoji) onTaunt(emoji);
          // Brief highlight flash
          (btn as HTMLElement).style.borderColor = '#00ffcc';
          setTimeout(() => {
            (btn as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)';
          }, 150);
        };
      });
    }

    // Wire buttons
    const soundBtn =
      this.element.querySelector<HTMLButtonElement>('#hud-sound-btn');
    if (soundBtn && onSoundToggle) {
      soundBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSoundToggle();
      };
    }

    const fsBtn =
      this.element.querySelector<HTMLButtonElement>('#fullscreen-btn');
    if (fsBtn) {
      fsBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const container = document.getElementById(
          'game-container',
        ) as FullscreenElement;
        if (!container) return;
        const doc = document as FullscreenDocument;
        if (!doc.fullscreenElement) {
          if (container.requestFullscreen)
            container
              .requestFullscreen()
              .catch(() => this.togglePseudoFullscreen());
          else if (container.webkitRequestFullscreen)
            container.webkitRequestFullscreen();
          else if (container.mozRequestFullScreen)
            container.mozRequestFullScreen();
          else if (container.msRequestFullscreen)
            container.msRequestFullscreen();
        } else {
          if (doc.exitFullscreen) doc.exitFullscreen();
          else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
          else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
          else if (doc.msExitFullscreen) doc.msExitFullscreen();
          this.togglePseudoFullscreen(false);
        }
      };
    }
  }

  private energyBar(
    ship: {
      stats?: { primaryColor?: string };
      isShieldActive?: boolean;
      isThrusting?: boolean;
      steeringDirection?: -1 | 0 | 1;
      invulnerabilityTimer?: number;
      energy?: number;
      maxEnergy?: number;
    } | null,
    color: string,
    positionStyle: string,
  ): string {
    if (!ship?.stats) return '';
    const pct = Math.max(
      0,
      Math.min(100, ((ship.energy ?? 0) / (ship.maxEnergy ?? 100)) * 100),
    );
    const barColor = pct > 40 ? color : pct > 15 ? '#ffaa00' : '#ff3333';
    const propulsion = [
      ship.isThrusting ? 'FORWARD THRUST' : '',
      ship.steeringDirection === -1 ? 'TURN LEFT' :
        ship.steeringDirection === 1 ? 'TURN RIGHT' : '',
    ].filter(Boolean).join(' + ');
    return `
      <div style="position: absolute; bottom: 60px; ${positionStyle}; pointer-events: none; width: 180px;">
        <div style="font-size: 10px; color: #888; text-align: center; margin-bottom: 2px;">ENERGY</div>
        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 3px; transition: width 0.1s, background 0.3s;"></div>
        </div>
        ${propulsion ? `<div data-testid="propulsion-state" style="font-size: 10px; color: #65d9ff; text-align: center; margin-top: 2px;">${propulsion}</div>` : ''}
        ${ship.isShieldActive ? `<div style="font-size: 10px; color: ${color}; text-align: center; margin-top: 2px;">🛡 SHIELD</div>` : ''}
        ${(ship.invulnerabilityTimer ?? 0) > 0 ? '<div style="font-size: 10px; color: #ffcc00; text-align: center; margin-top: 2px;">✨ RESPAWN</div>' : ''}
      </div>
    `;
  }

  private playerPanel(
    playerId: string,
    state: GameState,
    ship: {
      stats?: { primaryColor?: string };
      isShieldActive?: boolean;
    } | null,
    color: string,
  ): string {
    const name = state.playerCallSigns[playerId] || 'PILOT';
    const score = state.score[playerId] || 0;
    const lives = state.lives[playerId] ?? 3;
    const hearts = '❤️'.repeat(Math.max(0, lives));
    const shipColor = ship?.stats?.primaryColor || color;

    return `<div data-testid="p1-stats" style="min-width: 120px;">
      <div style="font-size: 13px; color: ${shipColor}; font-weight: bold;">${name}</div>
      <div style="font-size: 14px;">${score.toLocaleString()}</div>
      <div style="font-size: 11px;">${hearts}</div>
    </div>`;
  }

  // ─── Fullscreen helpers ───────────────────────────────────────

  private supportsFullscreen(): boolean {
    if (
      (window.navigator as NavigatorStandalone).standalone ||
      window.matchMedia('(display-mode: standalone)').matches
    )
      return false;
    const container = document.getElementById(
      'game-container',
    ) as FullscreenElement | null;
    return !!(
      container?.requestFullscreen ||
      container?.webkitRequestFullscreen ||
      container?.mozRequestFullScreen ||
      container?.msRequestFullscreen
    );
  }

  private togglePseudoFullscreen(force?: boolean) {
    const isPseudo = document.body.classList.toggle('pseudo-fullscreen', force);
    if (isPseudo) {
      document.body.style.position = 'fixed';
      document.body.style.top = '0';
      document.body.style.left = '0';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      document.body.style.zIndex = '9999';
      window.scrollTo(0, 1);
    } else {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.zIndex = '';
    }
  }
}
