import { PlayerInput } from '../engine/state';

export interface GamepadCalibrationProfile {
  deadzone: number;
  centerX: number;
  centerY: number;
  triggerThreshold: number;
  updatedAt: number;
}

export interface GamepadButtonState {
  index: number;
  pressed: boolean;
  value: number;
}

export interface GamepadCalibrationSnapshot {
  id: string;
  index: number;
  name: string;
  axes: {
    leftX: number;
    leftY: number;
    rightX: number;
    rightY: number;
  };
  buttons: GamepadButtonState[];
  triggers: {
    left: number;
    right: number;
  };
  profile: GamepadCalibrationProfile;
  drift: number;
  suggested: GamepadCalibrationProfile;
}

export class GamepadInput {
  private readonly PROFILE_PREFIX = 'osd_gamepad_profile_';
  private defaultDeadzone = 0.25;

  private normalizeKey(id: string): string {
    return id.replace(/[^\w-]/g, '_').substring(0, 80) || 'unknown';
  }

  private getProfileKey(id: string): string {
    return this.PROFILE_PREFIX + this.normalizeKey(id);
  }

  private readLegacyDeadzone(id: string): number | null {
    const saved = localStorage.getItem(`osd_deadzone_${this.normalizeKey(id)}`);
    if (!saved) return null;
    const parsed = Number.parseFloat(saved);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private defaultProfile(): GamepadCalibrationProfile {
    return {
      deadzone: this.defaultDeadzone,
      centerX: 0,
      centerY: 0,
      triggerThreshold: 0.5,
      updatedAt: Date.now(),
    };
  }

  public getProfileForDevice(id: string): GamepadCalibrationProfile {
    const saved = localStorage.getItem(this.getProfileKey(id));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<GamepadCalibrationProfile>;
        return {
          deadzone:
            typeof parsed.deadzone === 'number'
              ? parsed.deadzone
              : this.defaultDeadzone,
          centerX: typeof parsed.centerX === 'number' ? parsed.centerX : 0,
          centerY: typeof parsed.centerY === 'number' ? parsed.centerY : 0,
          triggerThreshold:
            typeof parsed.triggerThreshold === 'number'
              ? parsed.triggerThreshold
              : 0.5,
          updatedAt:
            typeof parsed.updatedAt === 'number'
              ? parsed.updatedAt
              : Date.now(),
        };
      } catch {
        // fall through to legacy/default handling
      }
    }

    const legacyDeadzone = this.readLegacyDeadzone(id);
    if (legacyDeadzone !== null) {
      return {
        ...this.defaultProfile(),
        deadzone: legacyDeadzone,
      };
    }

    return this.defaultProfile();
  }

  public saveProfileForDevice(id: string, profile: GamepadCalibrationProfile) {
    const normalized = {
      deadzone: this.clamp(profile.deadzone, 0.05, 0.6),
      centerX: this.clamp(profile.centerX, -0.35, 0.35),
      centerY: this.clamp(profile.centerY, -0.35, 0.35),
      triggerThreshold: this.clamp(profile.triggerThreshold, 0.1, 1),
      updatedAt: Date.now(),
    };
    localStorage.setItem(this.getProfileKey(id), JSON.stringify(normalized));
    localStorage.setItem(
      `osd_deadzone_${this.normalizeKey(id)}`,
      String(normalized.deadzone),
    );
  }

  public resetProfileForDevice(id: string) {
    localStorage.removeItem(this.getProfileKey(id));
    localStorage.removeItem(`osd_deadzone_${this.normalizeKey(id)}`);
  }

  public getCalibrationSnapshots(): GamepadCalibrationSnapshot[] {
    if (!navigator.getGamepads) return [];

    const gamepads = navigator.getGamepads();
    const snapshots: GamepadCalibrationSnapshot[] = [];

    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i]!;
      if (!gp) continue;

      const profile = this.getProfileForDevice(gp.id);
      const axes = {
        leftX: Number(gp.axes?.[0] ?? 0),
        leftY: Number(gp.axes?.[1] ?? 0),
        rightX: Number(gp.axes?.[2] ?? 0),
        rightY: Number(gp.axes?.[3] ?? 0),
      };
      const adjustedX = axes.leftX - profile.centerX;
      const adjustedY = axes.leftY - profile.centerY;
      const drift = Math.sqrt(adjustedX * adjustedX + adjustedY * adjustedY);
      const suggestedDeadzone = this.clamp(
        Math.max(profile.deadzone, drift * 2.5 + 0.06),
        0.08,
        0.6,
      );

      snapshots.push({
        id: gp.id,
        index: i,
        name: gp.id || `Gamepad ${i + 1}`,
        axes,
        buttons: Array.from(gp.buttons || []).map((button, index) => ({
          index,
          pressed: !button?.pressed,
          value: Number(button?.value ?? 0),
        })),
        triggers: {
          left: Number(gp.buttons?.[6]?.value ?? 0),
          right: Number(gp.buttons?.[7]?.value ?? 0),
        },
        profile,
        drift,
        suggested: {
          deadzone: suggestedDeadzone,
          centerX: this.clamp(profile.centerX, -0.35, 0.35),
          centerY: this.clamp(profile.centerY, -0.35, 0.35),
          triggerThreshold: profile.triggerThreshold,
          updatedAt: profile.updatedAt,
        },
      });
    }

    return snapshots;
  }

  private applyProfileToAxis(value: number, center: number, deadzone: number) {
    const adjusted = value - center;
    return Math.abs(adjusted) <= deadzone ? 0 : adjusted;
  }

  public getInput(index: number = 0): PlayerInput | null {
    if (!navigator.getGamepads) return null;

    const gamepads = navigator.getGamepads();
    let gp: Gamepad | null = null;

    // If index is provided, try to get that specific gamepad
    // Otherwise, find the first available one (old behavior)
    if (index >= 0) {
      let count = 0;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]!) {
          if (count === index) {
            gp = gamepads[i]!;
            break;
          }
          count++;
        }
      }
    }

    if (!gp) return null;

    const profile = this.getProfileForDevice(gp.id);
    const deadzone = profile.deadzone;
    const x = this.applyProfileToAxis(
      Number(gp.axes?.[0] ?? 0),
      profile.centerX,
      deadzone,
    );
    const y = this.applyProfileToAxis(
      Number(gp.axes?.[1] ?? 0),
      profile.centerY,
      deadzone,
    );

    // Standard mapping
    // Buttons:
    // 0: A / Cross (Fire)
    // 1: B / Circle (Alt Fire)
    // 2: X / Square (Alt Fire 2, maybe not used)
    // 3: Y / Triangle
    // 4: LB (Shield)
    // 5: RB (Shield)
    // 6: LT (Shield)
    // 7: RT (Fire)
    // 12: D-pad Up (Thrust)
    // 13: D-pad Down
    // 14: D-pad Left (Left)
    // 15: D-pad Right (Right)

    // Axes:
    // 0: Left stick X
    // 1: Left stick Y

    let thrust = false;
    let left = false;
    let right = false;
    let fire = false;
    let fireSecondary = false;
    let shield = false;
    let pause = false;

    if (gp.buttons) {
      if (gp.buttons[12]?.pressed) thrust = true;
      if (gp.buttons[14]?.pressed) left = true;
      if (gp.buttons[15]?.pressed) right = true;

      if (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed) fire = true; // A or RT
      if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed)
        fireSecondary = true; // B or X
      if (
        gp.buttons[4]?.pressed ||
        gp.buttons[5]?.pressed ||
        gp.buttons[6]?.pressed
      )
        shield = true; // LB, RB, LT
      if (gp.buttons[9]?.pressed) pause = true; // Start
    }

    if (gp.axes) {
      if (x < 0) left = true;
      if (x > 0) right = true;
      if (y < 0) thrust = true;
    }

    // Only return input if any button/axis is actually pressed to avoid overriding other inputs when idle
    if (thrust || left || right || fire || fireSecondary || shield || pause) {
      return {
        thrust,
        left,
        right,
        fire,
        fireSecondary,
        shield,
        pause,
      };
    }

    return null;
  }
}
