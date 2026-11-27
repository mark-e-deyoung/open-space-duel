import type { GameState } from '../game/engine/state';
import controlMap from '../game/input/control-map.json';

const MAX_DIAGNOSTIC_LENGTH = 500;
const MAX_ROLE_LENGTH = 80;
// Fixed backdrops provide a definite available height; cards scroll inside it.
const MODAL_INSETS = `
  box-sizing: border-box;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
`;
const MODAL_CARD_BOUNDS = `
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
`;

function focusDialogTarget(target: HTMLElement): void {
  target.focus();
  // A wrapped Tab may focus the already-active button after the user scrolled up.
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function boundedText(value: unknown, maxLength: number): string {
  let text: string;
  try {
    text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  } catch {
    text = '[unprintable value]';
  }
  return Array.from(text.replace(/[\r\n\t]+/g, ' ')).slice(0, maxLength).join('');
}

export interface OverlayDiagnosticsModel {
  fps: number;
  tick: number;
  entities: number;
  particles: number;
  energy: string;
  role: string;
  ping: string | null;
  errors: string[];
}

export function buildOverlayDiagnosticsModel(
  state: GameState,
  role: string,
  localPlayerId: string,
  currentFps: number,
  errors: string[],
  pingMs?: number,
): OverlayDiagnosticsModel {
  const localShip = state.entities.find(
    (entity) => entity.type === 'ship' && entity.ownerId === localPlayerId,
  );
  const rawEnergy = localShip?.energy;
  const energyValue =
    typeof rawEnergy === 'number' && Number.isFinite(rawEnergy) ? rawEnergy : 0;

  return {
    fps: Number.isFinite(currentFps) ? Math.max(0, Math.trunc(currentFps)) : 0,
    tick: Number.isFinite(state.tick) ? Math.trunc(state.tick) : 0,
    entities: state.entities.length,
    particles: state.particles.length,
    energy: localShip ? `${Math.floor(energyValue)}%` : 'N/A',
    role: boundedText(role, MAX_ROLE_LENGTH),
    ping:
      pingMs !== undefined && Number.isFinite(pingMs)
        ? `${Math.max(0, Math.trunc(pingMs))}ms`
        : null,
    errors: errors
      .slice(-5)
      .map((error) => boundedText(error, MAX_DIAGNOSTIC_LENGTH)),
  };
}

export class Overlay {
  private readonly element: HTMLDivElement;
  private readonly disconnectElement: HTMLDivElement;
  private readonly disconnectButton: HTMLButtonElement;
  private readonly updateElement: HTMLDivElement;
  private isVisible = false;
  private disconnectVisible = false;
  private updateVisible = false;
  private activeDialogRoot: HTMLElement | null = null;
  private focusOrigin: HTMLElement | null = null;

  private frames = 0;
  private lastFpsTime = 0;
  private currentFps = 0;
  private errorLog: string[] = [];

  /** Called when the player clicks RETURN TO BASE on disconnect overlay. */
  public onReturnToMenu?: () => void;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'diagnostics-overlay';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', 'Diagnostics');
    this.element.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      color: #fff;
      font-size: 12px;
      background: rgba(0,0,0,0.5);
      padding: 5px;
      display: none;
      pointer-events: none;
      max-width: 300px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      z-index: 9999;
    `;
    parent.appendChild(this.element);

    this.disconnectElement = document.createElement('div');
    this.disconnectElement.dataset.testid = 'disconnect-overlay';
    this.disconnectElement.setAttribute('role', 'dialog');
    this.disconnectElement.setAttribute('aria-modal', 'true');
    this.disconnectElement.setAttribute(
      'aria-labelledby',
      'disconnect-overlay-title',
    );
    this.disconnectElement.style.cssText = `
      ${MODAL_INSETS}
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      color: #fff;
      pointer-events: auto;
    `;

    const disconnectCard = document.createElement('div');
    disconnectCard.style.cssText =
      `${MODAL_CARD_BOUNDS} background: rgba(255,0,0,0.8); padding: 40px; border: 4px solid #fff; color: #fff; text-align: center;`;

    const disconnectTitle = document.createElement('h2');
    disconnectTitle.id = 'disconnect-overlay-title';
    disconnectTitle.textContent = 'CONNECTION LOST';
    disconnectTitle.style.cssText = 'font-size: 32px; margin: 0 0 20px 0;';

    const disconnectMessage = document.createElement('p');
    disconnectMessage.textContent =
      'The link to the other pilot has been severed.';
    disconnectMessage.style.cssText = 'margin: 0 0 30px 0;';

    this.disconnectButton = document.createElement('button');
    this.disconnectButton.id = 'btn-return-menu';
    this.disconnectButton.dataset.testid = 'return-menu-btn';
    this.disconnectButton.type = 'button';
    this.disconnectButton.textContent = 'RETURN TO BASE';
    this.disconnectButton.style.cssText =
      'min-width: 44px; min-height: 44px; box-sizing: border-box; padding: 10px 20px; cursor: pointer; background: #000; color: #fff; border: 2px solid #fff; font-weight: bold;';
    this.disconnectButton.addEventListener('click', () => {
      this.setDisconnected(false);
      this.onReturnToMenu?.();
    });

    disconnectCard.append(
      disconnectTitle,
      disconnectMessage,
      this.disconnectButton,
    );
    this.disconnectElement.appendChild(disconnectCard);
    parent.appendChild(this.disconnectElement);

    this.updateElement = document.createElement('div');
    this.updateElement.dataset.testid = 'modal-overlay';
    this.updateElement.style.cssText = `
      ${MODAL_INSETS}
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.82);
      z-index: 10000;
      color: #fff;
      pointer-events: auto;
    `;
    parent.appendChild(this.updateElement);

    window.addEventListener('keydown', (event) => {
      if (this.activeDialogRoot) {
        // Dialog keys must not also reach global gameplay/menu listeners.
        // Keep native Enter/Space button activation and ordinary Tab traversal.
        event.stopImmediatePropagation();
        if (event.key === 'Tab') this.trapDialogFocus(event);
        return;
      }

      if (event.code === 'F3' || event.code === 'Backquote') {
        event.preventDefault();
        if (this.disconnectVisible || this.updateVisible) return;
        this.isVisible = !this.isVisible;
        this.syncDiagnosticsVisibility();
      }
    }, true);

    window.addEventListener('error', (event) => {
      this.logError(
        `Error: ${boundedText(event.message, MAX_DIAGNOSTIC_LENGTH)}`,
      );
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.logError(
        `Promise Rejection: ${boundedText(event.reason, MAX_DIAGNOSTIC_LENGTH)}`,
      );
    });
  }

  private logError(message: string): void {
    this.errorLog.push(boundedText(message, MAX_DIAGNOSTIC_LENGTH));
    if (this.errorLog.length > 5) this.errorLog.shift();
  }

  private syncDiagnosticsVisibility(): void {
    this.element.style.display =
      this.isVisible && !this.disconnectVisible && !this.updateVisible
        ? 'block'
        : 'none';
  }

  private captureFocusOrigin(): void {
    if (this.focusOrigin) return;
    const active = document.activeElement;
    this.focusOrigin = active instanceof HTMLElement ? active : null;
  }

  private restoreFocusOrigin(): void {
    const target = this.focusOrigin;
    this.focusOrigin = null;
    if (!target?.isConnected) return;
    queueMicrotask(() => target.focus());
  }

  private trapDialogFocus(event: KeyboardEvent): void {
    const root = this.activeDialogRoot;
    if (!root) return;

    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    if (!root.contains(active)) {
      event.preventDefault();
      focusDialogTarget(event.shiftKey ? last : first);
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      focusDialogTarget(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusDialogTarget(first);
    }
  }

  public show(): void {
    this.isVisible = true;
    this.syncDiagnosticsVisibility();
  }

  public hide(): void {
    this.isVisible = false;
    this.syncDiagnosticsVisibility();
  }

  public setDisconnected(active: boolean): void {
    if (active && this.updateVisible) return;

    if (active) {
      if (!this.disconnectVisible) this.captureFocusOrigin();
      this.disconnectVisible = true;
      this.isVisible = false;
      this.activeDialogRoot = this.disconnectElement;
      this.disconnectElement.style.display = 'flex';
      this.syncDiagnosticsVisibility();
      queueMicrotask(() => focusDialogTarget(this.disconnectButton));
      return;
    }

    const wasVisible = this.disconnectVisible;
    this.disconnectVisible = false;
    this.disconnectElement.style.display = 'none';
    if (this.activeDialogRoot === this.disconnectElement) {
      this.activeDialogRoot = null;
    }
    this.syncDiagnosticsVisibility();
    if (wasVisible && !this.updateVisible) this.restoreFocusOrigin();
  }

  private createModalCard(
    label: string,
    width: string,
    borderColor: string,
    shadow: string,
  ): HTMLDivElement {
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', label);
    card.tabIndex = -1;
    card.style.cssText = `
      ${MODAL_CARD_BOUNDS}
      width: ${width};
      padding: 28px;
      border: 2px solid ${borderColor};
      background: rgba(0,0,0,0.94);
      box-shadow: ${shadow};
      text-align: center;
    `;
    return card;
  }

  private showModal(card: HTMLElement, focusTarget?: HTMLElement): void {
    if (!this.updateVisible && !this.disconnectVisible) this.captureFocusOrigin();

    this.isVisible = false;
    this.updateVisible = true;
    this.disconnectVisible = false;
    this.disconnectElement.style.display = 'none';
    this.updateElement.replaceChildren(card);
    this.updateElement.style.display = 'flex';
    this.activeDialogRoot = card;
    this.syncDiagnosticsVisibility();
    queueMicrotask(() => focusDialogTarget(focusTarget ?? card));
  }

  private dismissModal(): void {
    if (!this.updateVisible) return;
    this.updateVisible = false;
    this.updateElement.style.display = 'none';
    this.updateElement.replaceChildren();
    this.activeDialogRoot = null;
    this.syncDiagnosticsVisibility();
    this.restoreFocusOrigin();
  }

  public showUpdateAvailable(
    currentVersion: string,
    latestVersion: string,
    onReload: () => void,
  ): void {
    const card = this.createModalCard(
      'Update ready',
      'min(92vw, 520px)',
      '#00ffcc',
      '0 0 30px rgba(0,255,204,0.2)',
    );
    card.dataset.testid = 'update-dialog';

    const title = document.createElement('h2');
    title.textContent = 'UPDATE READY';
    title.style.cssText =
      'margin: 0 0 14px 0; color: #00ffcc; font-size: 28px;';

    const message = document.createElement('p');
    message.textContent = 'A newer build is available.';
    message.style.cssText =
      'margin: 0 0 12px 0; color: #fff; font-size: 14px;';

    const versions = document.createElement('p');
    versions.textContent = `Current: ${boundedText(currentVersion, 80)} | Latest: ${boundedText(latestVersion, 80)}`;
    versions.style.cssText =
      'margin: 0 0 18px 0; color: #ffaa00; font-size: 13px;';

    const note = document.createElement('p');
    note.textContent =
      'Load the new flight system to get the latest duel telemetry and fixes.';
    note.style.cssText =
      'margin: 0 0 24px 0; color: #aaa; font-size: 12px;';

    const button = document.createElement('button');
    button.id = 'btn-load-update';
    button.type = 'button';
    button.textContent = 'LOAD UPDATE';
    button.style.cssText =
      'min-width: 44px; min-height: 44px; box-sizing: border-box; padding: 12px 24px; cursor: pointer; background: #00ffcc; color: #000; border: none; font-weight: bold; border-radius: 4px;';
    button.addEventListener('click', onReload);

    card.append(title, message, versions, note, button);
    this.showModal(card, button);
  }

  public showTutorial(onDismiss: () => void): void {
    const card = this.createModalCard(
      'Welcome pilot tutorial',
      'min(92vw, 560px)',
      '#00ffcc',
      '0 0 30px rgba(0,255,204,0.2)',
    );
    card.dataset.testid = 'tutorial-dialog';

    const title = document.createElement('h2');
    title.textContent = 'WELCOME, PILOT';
    title.style.cssText =
      'margin: 0 0 8px 0; color: #00ffcc; font-size: 28px;';

    const intro = document.createElement('p');
    intro.textContent = "Your first deployment. Here's how to fly.";
    intro.style.cssText =
      'margin: 0 0 20px 0; color: #aaa; font-size: 13px;';

    const controls = document.createElement('div');
    controls.style.cssText =
      'display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; text-align: left; margin-bottom: 24px;';

    const addControl = (keys: string, description: string): void => {
      const keyCell = document.createElement('div');
      keyCell.style.cssText = 'color: #00ffcc; font-size: 13px;';
      const strong = document.createElement('strong');
      strong.textContent = keys;
      keyCell.appendChild(strong);

      const descriptionCell = document.createElement('div');
      descriptionCell.textContent = description;
      descriptionCell.style.cssText = 'color: #fff; font-size: 13px;';
      controls.append(keyCell, descriptionCell);
    };

    const standard = controlMap.keyboard.standard;
    addControl(`🚀 ${standard.thrust.label}`, 'Thrust');
    addControl(
      `↔ ${standard.left.label} · ${standard.right.label}`,
      'Steer',
    );
    addControl(`🔥 ${standard.fire.label}`, 'Fire primary weapon');
    addControl(`⚡ ${standard.fireSecondary.label}`, 'Fire secondary weapon');
    addControl(`🛡 ${standard.shield.label}`, 'Raise shields');
    addControl(`⏸ ${standard.pause.label}`, 'Pause the game');

    card.append(title, intro, controls);

    if (window.innerWidth < 768 || 'ontouchstart' in window) {
      const mobileNote = document.createElement('p');
      mobileNote.textContent =
        '📱 On mobile: use the virtual joystick on the left side of the screen and tilt controls (tap the tilt icon to enable gyro steering).';
      mobileNote.style.cssText =
        'margin: 16px 0 0 0; color: #888; font-size: 12px;';
      card.appendChild(mobileNote);
    }

    const button = document.createElement('button');
    button.id = 'btn-dismiss-tutorial';
    button.type = 'button';
    button.textContent = 'GOT IT';
    button.style.cssText =
      'min-width: 44px; min-height: 44px; box-sizing: border-box; margin-top: 20px; padding: 12px 28px; cursor: pointer; background: #00ffcc; color: #000; border: none; font-weight: bold; border-radius: 4px; font-size: 15px;';
    button.addEventListener('click', () => {
      this.dismissModal();
      onDismiss();
    });
    card.appendChild(button);

    this.showModal(card, button);
  }

  public showDuelInvite(
    friendName: string,
    onAccept: () => void,
    onDecline: () => void,
  ): void {
    const card = this.createModalCard(
      'Duel invite',
      'min(92vw, 460px)',
      '#6688ff',
      '0 0 40px rgba(102,136,255,0.25)',
    );
    card.dataset.testid = 'duel-invite-dialog';

    const icon = document.createElement('div');
    icon.textContent = '🚀';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'font-size: 48px; margin-bottom: 12px;';

    const title = document.createElement('h2');
    title.textContent = 'DUEL INVITE';
    title.style.cssText =
      'margin: 0 0 6px 0; color: #6688ff; font-size: 22px;';

    const message = document.createElement('p');
    message.style.cssText =
      'margin: 0 0 28px 0; color: #ddd; font-size: 14px;';
    const friend = document.createElement('strong');
    friend.textContent = boundedText(friendName, 128);
    friend.style.color = '#fff';
    message.append(friend, document.createTextNode(' invites you to a duel!'));

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;';

    const acceptButton = document.createElement('button');
    acceptButton.id = 'btn-invite-accept';
    acceptButton.type = 'button';
    acceptButton.textContent = '✓ ACCEPT';
    acceptButton.style.cssText =
      'padding: 12px 28px; cursor: pointer; background: #00ffcc; color: #000; border: none; font-weight: bold; border-radius: 4px; font-size: 14px;';
    acceptButton.addEventListener('click', () => {
      this.dismissModal();
      onAccept();
    });

    const declineButton = document.createElement('button');
    declineButton.id = 'btn-invite-decline';
    declineButton.type = 'button';
    declineButton.textContent = '✕ DECLINE';
    declineButton.style.cssText =
      'padding: 12px 28px; cursor: pointer; background: #333; color: #ccc; border: 1px solid #555; border-radius: 4px; font-size: 14px;';
    declineButton.addEventListener('click', () => {
      this.dismissModal();
      onDecline();
    });

    actions.append(acceptButton, declineButton);
    card.append(icon, title, message, actions);
    this.showModal(card, acceptButton);
  }

  public hideUpdateAvailable(): void {
    this.dismissModal();
  }

  public update(
    state: GameState,
    role: string,
    localPlayerId: string,
    pingMs?: number,
  ): void {
    if (!this.isVisible || this.disconnectVisible || this.updateVisible) return;

    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frames;
      this.frames = 0;
      this.lastFpsTime = now;
    }

    const model = buildOverlayDiagnosticsModel(
      state,
      role,
      localPlayerId,
      this.currentFps,
      this.errorLog,
      pingMs,
    );

    const lines = [
      `FPS: ${model.fps}`,
      `Tick: ${model.tick}`,
      `Entities: ${model.entities}`,
      `Particles: ${model.particles}`,
      `Energy: ${model.energy}`,
      `Role: ${model.role}`,
    ];
    if (model.ping !== null) lines.push(`Ping: ${model.ping}`);
    if (model.errors.length > 0) {
      lines.push('Errors:', ...model.errors.map((error) => `- ${error}`));
    }

    this.element.textContent = lines.join('\n');
  }
}
