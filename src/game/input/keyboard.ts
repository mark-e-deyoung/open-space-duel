import { PlayerInput } from '../engine/state';
import controlMap from './control-map.json';

type KeyBinding = {
  codes: string[];
  keys: string[];
  label: string;
};

type KeyboardControlSet = {
  thrust: KeyBinding;
  left: KeyBinding;
  right: KeyBinding;
  fire: KeyBinding;
  fireSecondary: KeyBinding;
  shield: KeyBinding;
  pause: KeyBinding;
};

const keyboardProfiles = controlMap.keyboard as Record<string, KeyboardControlSet>;
const allBindings = Object.values(keyboardProfiles).flatMap((profile) =>
  Object.values(profile),
);
const gameCodes = new Set(allBindings.flatMap((binding) => binding.codes));
const gameKeys = new Set(allBindings.flatMap((binding) => binding.keys));

function nativeControlOwnsKeyboard(target: EventTarget | null): boolean {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement &&
    target.closest('button, input, select, textarea, a[href], [contenteditable]:not([contenteditable="false"]), [role="dialog"]') !== null;
}

function isPressed(keys: Set<string>, binding: KeyBinding): boolean {
  return (
    binding.codes.some((code) => keys.has(code)) ||
    binding.keys.some((key) => keys.has(key))
  );
}

function inputFromProfile(
  keys: Set<string>,
  profile: KeyboardControlSet,
): PlayerInput {
  return {
    thrust: isPressed(keys, profile.thrust),
    left: isPressed(keys, profile.left),
    right: isPressed(keys, profile.right),
    fire: isPressed(keys, profile.fire),
    fireSecondary: isPressed(keys, profile.fireSecondary),
    shield: isPressed(keys, profile.shield),
    pause: isPressed(keys, profile.pause),
  };
}

export class KeyboardInput {
  private keys: Set<string> = new Set();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.onKeyDown(e);
      // Ensure game container or window is focused on interaction
    });
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    // Reset keys on blur to prevent stuck keys
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onKeyDown(e: KeyboardEvent) {
    // Native controls own their keyboard events, including Enter/Space clicks
    // and typing. A canonical gameplay binding must not cancel those actions.
    if (e.defaultPrevented) return;
    if (nativeControlOwnsKeyboard(e.target)) {
      this.keys.clear();
      return;
    }

    this.keys.add(e.code);
    if (e.key) this.keys.add(e.key);

    // Prevent default for game keys to avoid scrolling/shortcuts. The same
    // canonical bindings drive both runtime behavior and human-facing docs.
    if (gameCodes.has(e.code) || gameKeys.has(e.key)) {
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
    if (e.key) this.keys.delete(e.key);
  }

  public getInput(
    index: number = 0,
    isLocalMulti: boolean = false,
  ): PlayerInput {
    // Focus can move into a dialog while a gameplay key is already held.
    if (typeof document !== 'undefined' && nativeControlOwnsKeyboard(document.activeElement)) {
      this.keys.clear();
    }

    if (!isLocalMulti) {
      return inputFromProfile(
        this.keys,
        controlMap.keyboard.standard as KeyboardControlSet,
      );
    }

    return inputFromProfile(
      this.keys,
      (index === 0
        ? controlMap.keyboard.localPlayer1
        : controlMap.keyboard.localPlayer2) as KeyboardControlSet,
    );
  }
}
