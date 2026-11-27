import { PlayerInput } from '../game/engine/state';

interface TouchControlConfig {
  rotateRing: number;
  thrustRing: number;
  updatedAt: number;
}

interface TiltControlProfile {
  neutralGamma: number;
  neutralBeta: number;
  neutralCaptured: boolean;
  deadzone: number;
  sensitivity: number;
  invertSteer: boolean;
  invertThrust: boolean;
  updatedAt: number;
}

interface TiltOrientationSnapshot {
  gamma: number;
  beta: number;
  angle: number;
  deltaGamma: number;
  deltaBeta: number;
  steerValue: number;
  thrustValue: number;
  steerActive: boolean;
  thrustActive: boolean;
  baselineCaptured: boolean;
  supported: boolean;
  enabled: boolean;
}

export class Joypad {
  private container: HTMLDivElement;
  private btnTilt: HTMLButtonElement | null = null;
  private isEnabled: boolean = false;
  private inputState: PlayerInput = {
    thrust: false,
    left: false,
    right: false,
    fire: false,
    fireSecondary: false,
    shield: false,
  };
  public tiltEnabled: boolean = false;

  private thumbstickBase: HTMLDivElement | null = null;
  private thumbstickKnob: HTMLDivElement | null = null;
  private thumbstickInnerRing: HTMLDivElement | null = null;
  private thumbstickThrustRing: HTMLDivElement | null = null;
  private thumbstickActive: boolean = false;
  private touchId: number | null = null;
  private thumbstickOrigin = { x: 0, y: 0 };
  private maxRadius = 60;
  private thrustThreshold = 35;
  private deadzone = 8;
  private touchConfig: TouchControlConfig = {
    rotateRing: 8,
    thrustRing: 35,
    updatedAt: Date.now(),
  };
  private tiltProfile: TiltControlProfile = {
    neutralGamma: 0,
    neutralBeta: 0,
    neutralCaptured: false,
    deadzone: 12,
    sensitivity: 1,
    invertSteer: false,
    invertThrust: false,
    updatedAt: Date.now(),
  };
  private lastOrientation: {
    gamma: number;
    beta: number;
    angle: number;
    timestamp: number;
  } | null = null;
  private tiltRuntimeBaseline: { gamma: number; beta: number } | null = null;
  private tiltListenersAttached = false;
  private readonly touchConfigKey = 'osd_touch_controls';
  private readonly tiltProfileKey = 'osd_tilt_profile';

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'joypad-container';
    this.container.setAttribute('data-testid', 'joypad-container');
    this.container.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      /* Leave unused gesture space available; the thumbstick/buttons opt out. */
      touch-action: auto;
      z-index: 100;
    `;

    // Prevent context menu popups (Silk/Safari)
    this.container.oncontextmenu = (e) => {
      e.preventDefault();
      return false;
    };

    this.setupButtons();
    this.refreshTouchConfig();
    this.refreshTiltProfile();
    parent.appendChild(this.container);

    // Detect touch capability
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      // By default we start hidden, but touch devices can activate it
    }

    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleOrientationChange = this.handleOrientationChange.bind(this);
    window.addEventListener('orientationchange', this.handleOrientationChange);
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private defaultTouchConfig(): TouchControlConfig {
    return {
      rotateRing: 8,
      thrustRing: 35,
      updatedAt: Date.now(),
    };
  }

  private refreshTouchConfig() {
    try {
      const saved = localStorage.getItem(this.touchConfigKey);
      if (!saved) {
        this.touchConfig = this.defaultTouchConfig();
      } else {
        const parsed = JSON.parse(saved) as Partial<TouchControlConfig>;
        this.touchConfig = {
          rotateRing: this.clamp(
            typeof parsed.rotateRing === 'number' ? parsed.rotateRing : 8,
            4,
            28,
          ),
          thrustRing: this.clamp(
            typeof parsed.thrustRing === 'number' ? parsed.thrustRing : 35,
            18,
            this.maxRadius,
          ),
          updatedAt:
            typeof parsed.updatedAt === 'number'
              ? parsed.updatedAt
              : Date.now(),
        };
      }
    } catch {
      this.touchConfig = this.defaultTouchConfig();
    }

    if (this.touchConfig.thrustRing < this.touchConfig.rotateRing + 8) {
      this.touchConfig.thrustRing = this.clamp(
        this.touchConfig.rotateRing + 8,
        18,
        this.maxRadius,
      );
    }

    this.deadzone = this.touchConfig.rotateRing;
    this.thrustThreshold = this.touchConfig.thrustRing;
  }

  private defaultTiltProfile(): TiltControlProfile {
    return {
      neutralGamma: 0,
      neutralBeta: 0,
      neutralCaptured: false,
      deadzone: 12,
      sensitivity: 1,
      invertSteer: false,
      invertThrust: false,
      updatedAt: Date.now(),
    };
  }

  private refreshTiltProfile() {
    try {
      const saved = localStorage.getItem(this.tiltProfileKey);
      if (!saved) {
        this.tiltProfile = this.defaultTiltProfile();
        return;
      }

      const parsed = JSON.parse(saved) as Partial<TiltControlProfile>;
      this.tiltProfile = {
        neutralGamma:
          typeof parsed.neutralGamma === 'number' ? parsed.neutralGamma : 0,
        neutralBeta:
          typeof parsed.neutralBeta === 'number' ? parsed.neutralBeta : 0,
        neutralCaptured: !!parsed.neutralCaptured,
        deadzone: this.clamp(
          typeof parsed.deadzone === 'number' ? parsed.deadzone : 12,
          2,
          45,
        ),
        sensitivity: this.clamp(
          typeof parsed.sensitivity === 'number' ? parsed.sensitivity : 1,
          0.5,
          2.5,
        ),
        invertSteer: !!parsed.invertSteer,
        invertThrust: !!parsed.invertThrust,
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    } catch {
      this.tiltProfile = this.defaultTiltProfile();
    }
  }

  public isTiltSupported(): boolean {
    return typeof window.DeviceOrientationEvent === 'function';
  }

  public getTiltState(): TiltOrientationSnapshot {
    const last = this.lastOrientation;
    const profile = this.tiltProfile;
    const runtimeBaseline = this.tiltRuntimeBaseline;
    const baselineGamma = profile.neutralCaptured
      ? profile.neutralGamma
      : (runtimeBaseline?.gamma ?? 0);
    const baselineBeta = profile.neutralCaptured
      ? profile.neutralBeta
      : (runtimeBaseline?.beta ?? 0);
    const deltaGamma = (last?.gamma ?? 0) - baselineGamma;
    const deltaBeta = (last?.beta ?? 0) - baselineBeta;
    const angle = last?.angle ?? this.getScreenOrientationAngle();
    const mapped = this.mapTiltToInput(deltaGamma, deltaBeta, angle);

    return {
      gamma: last?.gamma ?? 0,
      beta: last?.beta ?? 0,
      angle,
      deltaGamma,
      deltaBeta,
      steerValue: mapped.steerValue,
      thrustValue: mapped.thrustValue,
      steerActive: mapped.steerActive,
      thrustActive: mapped.thrustActive,
      baselineCaptured:
        profile.neutralCaptured || this.tiltRuntimeBaseline !== null,
      supported: this.isTiltSupported(),
      enabled: this.tiltEnabled,
    };
  }

  private getScreenOrientationAngle(): number {
    const orientation = window.screen?.orientation;
    if (orientation && typeof orientation.angle === 'number') {
      const normalized = ((orientation.angle % 360) + 360) % 360;
      return normalized;
    }

    const legacy = (window as Window & { orientation?: number }).orientation;
    if (typeof legacy === 'number') {
      return ((legacy % 360) + 360) % 360;
    }

    return window.innerWidth > window.innerHeight ? 90 : 0;
  }

  private mapTiltToInput(
    deltaGamma: number,
    deltaBeta: number,
    angle: number,
  ): {
    steerValue: number;
    thrustValue: number;
    steerActive: boolean;
    thrustActive: boolean;
  } {
    let steerValue = deltaGamma;
    let thrustValue = deltaBeta;

    if (angle === 90) {
      steerValue = deltaBeta;
      thrustValue = -deltaGamma;
    } else if (angle === 180) {
      steerValue = -deltaGamma;
      thrustValue = -deltaBeta;
    } else if (angle === 270) {
      steerValue = -deltaBeta;
      thrustValue = deltaGamma;
    }

    if (this.tiltProfile.invertSteer) steerValue *= -1;
    if (this.tiltProfile.invertThrust) thrustValue *= -1;

    const sensitivity = this.tiltProfile.sensitivity;
    const steerMagnitude = Math.abs(steerValue * sensitivity);
    const thrustMagnitude = Math.abs(thrustValue * sensitivity);

    return {
      steerValue: steerValue * sensitivity,
      thrustValue: thrustValue * sensitivity,
      steerActive: steerMagnitude > this.tiltProfile.deadzone,
      thrustActive: thrustMagnitude > this.tiltProfile.deadzone,
    };
  }

  private handleOrientation(event: DeviceOrientationEvent) {
    const gamma = Number.isFinite(event.gamma) ? Number(event.gamma) : 0;
    const beta = Number.isFinite(event.beta) ? Number(event.beta) : 0;
    const angle = this.getScreenOrientationAngle();
    this.lastOrientation = {
      gamma,
      beta,
      angle,
      timestamp: Date.now(),
    };

    if (!this.tiltEnabled || !this.isEnabled) return;

    const profile = this.tiltProfile;
    if (!profile.neutralCaptured && !this.tiltRuntimeBaseline) {
      this.tiltRuntimeBaseline = { gamma, beta };
      return;
    }

    const baselineGamma = profile.neutralCaptured
      ? profile.neutralGamma
      : (this.tiltRuntimeBaseline?.gamma ?? gamma);
    const baselineBeta = profile.neutralCaptured
      ? profile.neutralBeta
      : (this.tiltRuntimeBaseline?.beta ?? beta);

    const deltaGamma = gamma - baselineGamma;
    const deltaBeta = beta - baselineBeta;
    const mapped = this.mapTiltToInput(deltaGamma, deltaBeta, angle);

    this.inputState.left = mapped.steerActive && mapped.steerValue < 0;
    this.inputState.right = mapped.steerActive && mapped.steerValue > 0;
    this.inputState.thrust = mapped.thrustActive && mapped.thrustValue < 0;
  }

  private handleOrientationChange() {
    this.lastOrientation = null;
    if (this.tiltEnabled) this.tiltRuntimeBaseline = null;
  }

  // Bound handler so 'this' resolves to the Joypad instance in event callbacks
  private boundHandleOrientation = this.handleOrientation.bind(this);

  private attachTiltListeners() {
    if (this.tiltListenersAttached || !this.isTiltSupported()) return;
    window.addEventListener('deviceorientation', this.boundHandleOrientation);
    window.addEventListener(
      'deviceorientationabsolute',
      this.boundHandleOrientation,
    );
    this.tiltListenersAttached = true;
  }

  private detachTiltListeners() {
    if (!this.tiltListenersAttached) return;
    window.removeEventListener(
      'deviceorientation',
      this.boundHandleOrientation,
    );
    window.removeEventListener(
      'deviceorientationabsolute',
      this.boundHandleOrientation,
    );
    this.tiltListenersAttached = false;
  }

  private syncTouchVisuals() {
    if (this.thumbstickInnerRing) {
      this.thumbstickInnerRing.style.width = `${this.deadzone * 2}px`;
      this.thumbstickInnerRing.style.height = `${this.deadzone * 2}px`;
    }

    if (this.thumbstickThrustRing) {
      this.thumbstickThrustRing.style.width = `${this.thrustThreshold * 2}px`;
      this.thumbstickThrustRing.style.height = `${this.thrustThreshold * 2}px`;
    }
  }

  private setupButtons() {
    const leftGroup = document.createElement('div');
    leftGroup.id = 'joy-left-group';
    leftGroup.setAttribute('data-testid', 'joy-left-group');
    leftGroup.style.cssText = `
      position: absolute;
      left: calc(2vw + env(safe-area-inset-left, 0px));
      bottom: 50%;
      transform: translateY(50%);
      display: flex;
      flex-direction: column;
      gap: 20px;
      pointer-events: none;
      min-width: 80px;
      min-height: 200px;
    `;

    const rightGroup = document.createElement('div');
    rightGroup.id = 'joy-right-group';
    rightGroup.setAttribute('data-testid', 'joy-right-group');
    rightGroup.style.cssText = `
      position: absolute;
      right: calc(2vw + env(safe-area-inset-right, 0px));
      bottom: 50%;
      transform: translateY(50%);
      display: flex;
      flex-direction: column;
      gap: 20px;
      align-items: flex-end;
      pointer-events: none;
      min-width: 80px;
      min-height: 200px;
    `;

    // Dynamic Thumbstick zone
    const touchZone = document.createElement('div');
    touchZone.setAttribute('data-testid', 'joy-touch-zone');
    touchZone.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 50vw;
      height: 100vh;
      pointer-events: auto;
      touch-action: none;
    `;
    this.container.appendChild(touchZone);

    this.thumbstickBase = document.createElement('div');
    this.thumbstickBase.setAttribute('data-testid', 'joy-thumbstick-base');
    this.thumbstickBase.style.cssText = `
      position: absolute;
      width: ${this.maxRadius * 2}px;
      height: ${this.maxRadius * 2}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.2);
      display: none;
      pointer-events: none;
      transform: translate(-50%, -50%);
    `;

    this.thumbstickInnerRing = document.createElement('div');
    this.thumbstickInnerRing.style.cssText = `
      position: absolute;
      width: ${this.deadzone * 2}px;
      height: ${this.deadzone * 2}px;
      border-radius: 50%;
      border: 1px dashed rgba(0, 255, 204, 0.2);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    `;
    this.thumbstickBase.appendChild(this.thumbstickInnerRing);

    this.thumbstickThrustRing = document.createElement('div');
    this.thumbstickThrustRing.style.cssText = `
      position: absolute;
      width: ${this.thrustThreshold * 2}px;
      height: ${this.thrustThreshold * 2}px;
      border-radius: 50%;
      border: 1px dashed rgba(255, 170, 0, 0.2);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    `;
    this.thumbstickBase.appendChild(this.thumbstickThrustRing);

    this.thumbstickKnob = document.createElement('div');
    this.thumbstickKnob.setAttribute('data-testid', 'joy-thumbstick-knob');
    this.thumbstickKnob.style.cssText = `
      position: absolute;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.4);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      box-shadow: 0 0 10px rgba(255,255,255,0.2);
    `;
    this.thumbstickBase.appendChild(this.thumbstickKnob);
    this.container.appendChild(this.thumbstickBase);

    touchZone.addEventListener('touchstart', this.handleTouchStart.bind(this), {
      passive: false,
    });
    touchZone.addEventListener('touchmove', this.handleTouchMove.bind(this), {
      passive: false,
    });
    touchZone.addEventListener('touchend', this.handleTouchEnd.bind(this), {
      passive: false,
    });
    touchZone.addEventListener('touchcancel', this.handleTouchEnd.bind(this), {
      passive: false,
    });

    // Actions (Right Column)
    const btnFire = this.createButton(
      'FIRE',
      () => (this.inputState.fire = true),
      () => (this.inputState.fire = false),
      '#ff00ff',
    );
    btnFire.setAttribute('data-testid', 'joy-fire-btn');

    const btnAlt = this.createButton(
      'ALT',
      () => (this.inputState.fireSecondary = true),
      () => (this.inputState.fireSecondary = false),
      '#ff9900',
    );
    btnAlt.setAttribute('data-testid', 'joy-alt-btn');

    const btnShield = this.createButton(
      'SHIELD',
      () => (this.inputState.shield = true),
      () => (this.inputState.shield = false),
      '#0066ff',
    );
    btnShield.setAttribute('data-testid', 'joy-shield-btn');

    this.btnTilt = document.createElement('button');
    this.btnTilt.innerText = 'TILT: OFF';
    this.btnTilt.setAttribute('data-testid', 'joy-tilt-toggle');
    this.btnTilt.style.cssText = `
      width: 65px;
      min-height: 44px;
      height: 44px;
      border-radius: 15px;
      border: 1px solid #aaa;
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      font-size: 10px;
      margin-bottom: 10px;
      pointer-events: auto;
      display: none;
      touch-action: manipulation;
    `;

    this.btnTilt.onclick = async () => {
      if (!this.isTiltSupported()) {
        console.warn('Device orientation is not supported in this browser');
        return;
      }

      const DeviceOrientationEventExtended =
        DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
        };

      if (
        typeof DeviceOrientationEventExtended.requestPermission === 'function'
      ) {
        try {
          const permissionState =
            await DeviceOrientationEventExtended.requestPermission();
          if (permissionState !== 'granted') {
            console.error('Device orientation permission denied');
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (!this.tiltEnabled) {
        this.refreshTiltProfile();
      }

      this.tiltEnabled = !this.tiltEnabled;
      this.lastOrientation = null;
      this.tiltRuntimeBaseline = null;

      if (!this.tiltEnabled) {
        this.detachTiltListeners();
        this.inputState.left = false;
        this.inputState.right = false;
        this.inputState.thrust = false;
      } else {
        this.attachTiltListeners();
      }

      this.updateTiltButtonUI();
    };

    [btnFire, btnAlt].forEach((b) => {
      b.style.width = '85px';
      b.style.height = '85px';
      b.style.borderRadius = '43px';
    });

    leftGroup.appendChild(this.btnTilt);

    rightGroup.appendChild(btnFire);
    rightGroup.appendChild(btnAlt);
    rightGroup.appendChild(btnShield);

    this.container.appendChild(leftGroup);
    this.container.appendChild(rightGroup);
    this.syncTouchVisuals();
  }

  private handleTouchStart(e: TouchEvent) {
    if (this.tiltEnabled || this.thumbstickActive || !this.isEnabled) return;
    e.preventDefault();

    const touch = e.changedTouches[0]!;
    this.touchId = touch.identifier;
    this.thumbstickOrigin.x = touch.clientX;
    this.thumbstickOrigin.y = touch.clientY;
    this.thumbstickActive = true;

    if (this.thumbstickBase && this.thumbstickKnob) {
      this.thumbstickBase.style.left = `${touch.clientX}px`;
      this.thumbstickBase.style.top = `${touch.clientY}px`;
      this.thumbstickBase.style.display = 'block';
      this.thumbstickKnob.style.transform = `translate(-50%, -50%)`;
    }
  }

  private handleTouchMove(e: TouchEvent) {
    if (!this.thumbstickActive || this.tiltEnabled || !this.isEnabled) return;
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]!;
      if (touch.identifier === this.touchId) {
        let dx = touch.clientX - this.thumbstickOrigin.x;
        let dy = touch.clientY - this.thumbstickOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.maxRadius) {
          dx = (dx / dist) * this.maxRadius;
          dy = (dy / dist) * this.maxRadius;
        }

        if (this.thumbstickKnob) {
          this.thumbstickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }

        // Two-Ring Logic:
        if (dist > this.deadzone) {
          this.inputState.targetRotation = Math.atan2(dy, dx);
          this.inputState.thrust = dist > this.thrustThreshold;
        } else {
          this.inputState.targetRotation = undefined;
          this.inputState.thrust = false;
        }
        break;
      }
    }
  }

  private handleTouchEnd(e: TouchEvent) {
    if (!this.thumbstickActive || !this.isEnabled) return;
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]!;
      if (touch.identifier === this.touchId) {
        this.thumbstickActive = false;
        this.touchId = null;

        // Fully reset input state to neutral
        this.inputState.targetRotation = undefined;
        this.inputState.thrust = false;
        this.inputState.left = false;
        this.inputState.right = false;

        if (this.thumbstickKnob) {
          this.thumbstickKnob.style.transform = `translate(-50%, -50%)`;
        }

        if (this.thumbstickBase) {
          this.thumbstickBase.style.display = 'none';
        }
        break;
      }
    }
  }

  private updateTiltButtonUI() {
    if (!this.btnTilt) return;
    this.btnTilt.innerText = this.tiltEnabled ? 'TILT: ON' : 'TILT: OFF';
    this.btnTilt.style.background = this.tiltEnabled
      ? 'rgba(0, 255, 0, 0.3)'
      : 'rgba(255, 255, 255, 0.2)';
  }

  private refreshTiltButtonVisibility() {
    if (!this.btnTilt) return;
    this.btnTilt.style.display =
      this.isEnabled && this.isTiltSupported() ? 'block' : 'none';
  }

  public resetTilt() {
    this.tiltEnabled = false;
    this.lastOrientation = null;
    this.tiltRuntimeBaseline = null;
    this.detachTiltListeners();
    this.inputState.left = false;
    this.inputState.right = false;
    this.inputState.thrust = false;
    this.updateTiltButtonUI();
  }

  private createButton(
    text: string,
    onDown: () => void,
    onUp: () => void,
    color: string = 'rgba(255, 255, 255, 0.5)',
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerText = text;
    const baseRgba = color.startsWith('#') ? this.hexToRgba(color, 0.2) : color;
    const activeRgba = color.startsWith('#')
      ? this.hexToRgba(color, 0.5)
      : 'rgba(255, 255, 255, 0.4)';

    btn.style.cssText = `
      width: 65px;
      height: 65px;
      border-radius: 33px;
      border: 2px solid ${color};
      background: ${baseRgba};
      color: #fff;
      font-weight: bold;
      font-size: 13px;
      display: flex;
      justify-content: center;
      align-items: center;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      outline: none;
      box-shadow: 0 0 10px ${color};
      transition: background 0.1s, transform 0.05s;
      pointer-events: auto;
    `;

    const start = (e: Event) => {
      e.preventDefault();
      if (!this.isEnabled) return;
      btn.style.background = activeRgba;
      btn.style.transform = 'scale(0.92)';
      onDown();
    };

    const end = (e: Event) => {
      e.preventDefault();
      if (!this.isEnabled) return;
      btn.style.background = baseRgba;
      btn.style.transform = 'scale(1.0)';
      onUp();
    };

    btn.addEventListener('touchstart', start);
    btn.addEventListener('touchend', end);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);

    return btn;
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  public getInput(): PlayerInput {
    return { ...this.inputState };
  }

  public isVisible(): boolean {
    return this.isEnabled;
  }

  public show() {
    // Only show if touch is enabled AND we are actually enabled for gameplay
    if (this.isEnabled) {
      this.refreshTouchConfig();
      this.refreshTiltProfile();
      this.syncTouchVisuals();
      this.container.style.display = 'block';
      // The full-screen layer must not intercept HUD controls or free-space
      // browser gestures. Children explicitly opt into pointer input.
      this.container.style.pointerEvents = 'none';
      this.refreshTiltButtonVisibility();
      if (this.tiltEnabled) this.attachTiltListeners();
    }
  }

  public hide() {
    this.detachTiltListeners();
    this.container.style.display = 'none';
    this.container.style.pointerEvents = 'none';
  }

  public enable() {
    this.isEnabled = true;
    this.show();
    this.refreshTiltButtonVisibility();
  }

  public disable() {
    this.isEnabled = false;
    this.detachTiltListeners();
    this.hide();
  }

  public setOrientation(isPortrait: boolean) {
    const leftGroup = this.container.querySelector(
      '#joy-left-group',
    ) as HTMLDivElement;
    const rightGroup = this.container.querySelector(
      '#joy-right-group',
    ) as HTMLDivElement;
    if (!leftGroup || !rightGroup) return;

    if (isPortrait) {
      leftGroup.style.bottom = '20px';
      rightGroup.style.bottom = '20px';
      leftGroup.style.transform = 'none';
      rightGroup.style.transform = 'none';
      rightGroup.style.gap = '20px';
      leftGroup.style.left = 'calc(2vw + env(safe-area-inset-left, 0px))';
      rightGroup.style.right = 'calc(2vw + env(safe-area-inset-right, 0px))';
    } else {
      // Landscape: center them vertically
      leftGroup.style.bottom = '50%';
      // In compact landscape the centered, full-height action stack can
      // overlap the HUD sound control. Keep targets >=44px, tighten only
      // spacing, and reserve the top-right HUD hit lane.
      if (window.innerHeight <= 350) {
        rightGroup.style.bottom = 'max(12px, env(safe-area-inset-bottom, 0px))';
        rightGroup.style.transform = 'none';
        rightGroup.style.gap = '8px';
      } else {
        rightGroup.style.bottom = '50%';
        rightGroup.style.transform = 'translateY(50%)';
        rightGroup.style.gap = '20px';
      }
      leftGroup.style.transform = 'translateY(50%)';
      leftGroup.style.left = 'calc(4vw + env(safe-area-inset-left, 0px))';
      rightGroup.style.right = 'calc(4vw + env(safe-area-inset-right, 0px))';
    }
  }
}
