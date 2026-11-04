import {
  createInitialState,
  GameState,
  PlayerInput,
  ShipClass,
  ShipCustomization,
  generateId,
} from './game/engine/state';
import { updatePhysics } from './game/systems/physics';
import { checkCollisions } from './game/systems/collision';
import { CanvasRenderer } from './game/render/canvas';
import { KeyboardInput } from './game/input/keyboard';
import { GamepadInput } from './game/input/gamepad';
import { createAsteroid } from './game/entities/asteroid';
import { createShip } from './game/entities/ship';
import { NetworkManager } from './game/net/sync';
import { LobbyManager } from './game/net/lobby';
import {
  createInviteLink,
  createResponseLink,
  parseLinkPayload,
  SignalingMessage,
} from './game/net/signaling';
import { MainMenu } from './ui/menu';
import { HUD } from './ui/hud';
import { MusicManager, CompositionType } from './game/audio/music';
import { SoundEngine, SoundType } from './game/audio/sound';
import { Joypad } from './ui/joypad';
import { Overlay } from './ui/overlay';
import { getPlayerIdentity, regenerateCallSign } from './utils/identity';
import { GameLoop } from './game/engine/loop';
import { SideArt } from './ui/sideArt';
import { DeterministicRNG } from './sim/prng';
import { tauntSoundFor } from './game/audio/tauntSounds';
import { ScoresClient } from './network/scoresClient';
import { PasscodeClient } from './network/passcodeClient';
import { FriendsManager } from './network/friends';
import { SpectateClient } from './network/spectateClient';
import { SpectateView } from './ui/spectateView';
import { joinRoom as joinNostr } from 'trystero/nostr';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  HEARTBEAT_TIMEOUT_MS,
} from './game/engine/worldConfig';
import { TelemetryCollector } from './utils/telemetryCollector';

declare const __APP_VERSION__: string;

// Public-source projection: ordinary gameplay only; no private QA capability.
const isLobbyEnabled = true;
function recordTrace(_event: string, _details?: Record<string, unknown>): void {}

// Initialize Player Identity
const identity = getPlayerIdentity();

// Sound setup (Early initialization for persistence)
const PERSIST_SOUND_KEY = 'osd_sound_enabled';
const storedSound = localStorage.getItem(PERSIST_SOUND_KEY);
let soundEnabled = storedSound !== 'false'; // Default to true

// Game State
let state: GameState | undefined;
let lastPausePressed = false;
let isLocalMultiplayer = false;

// UI & Audio Context
const AudioContextCtor =
  window.AudioContext || (window as any).webkitAudioContext;
let audioCtx: AudioContext | null = null;
let musicManager: MusicManager | null = null;
let soundEngine: SoundEngine | null = null;
let audioUnlocked = false;

function ensureAudio() {
  if (audioCtx || !AudioContextCtor) return audioCtx;
  audioCtx = new AudioContextCtor();
  musicManager = new MusicManager(audioCtx);
  soundEngine = new SoundEngine(audioCtx);
  return audioCtx;
}

function startMusicPlayback() {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx || !musicManager) return;

  audioUnlocked = true;
  syncMusicScene();

  if (ctx.state === 'suspended') {
    void ctx.resume().catch((error) => {
      console.warn('[AUDIO] Failed to resume audio context', error);
    });
  }

  musicManager.start();
}

// Resume AudioContext on first user interaction (Safari/Mobile fix)
const resumeAudio = () => {
  const ctx = ensureAudio();
  if (ctx) {
    audioUnlocked = true;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch((error) => {
        console.warn('[AUDIO] Failed to resume audio context', error);
      });
    }
    // Start audio playback now that user interaction has unlocked the context
    if (soundEnabled && musicManager) {
      syncMusicScene();
      musicManager.start();
    }
  }
  document.removeEventListener('click', resumeAudio);
  document.removeEventListener('touchstart', resumeAudio);
  document.removeEventListener('keydown', resumeAudio);
};
document.addEventListener('click', resumeAudio);
document.addEventListener('touchstart', resumeAudio);
document.addEventListener('keydown', resumeAudio);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;
const renderer = new CanvasRenderer(canvas);

function playSound(type: SoundType) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx || ctx.state === 'suspended') return;
  soundEngine?.playSound(type);
}

// Managers
const netManager = new NetworkManager(__APP_VERSION__);
netManager.localPlayerId = identity.id;
netManager.localCallSign = identity.callSign;

const menuParent = document.getElementById('ui-layer') || document.body;
const mainMenu = new MainMenu(menuParent);
const lobby = new LobbyManager((games) => mainMenu.updatePublicGames(games), {
  enabled: isLobbyEnabled,
});
const hud = new HUD(menuParent);
const joypad = new Joypad(menuParent);
const overlay = new Overlay(menuParent);
overlay.onReturnToMenu = () => {
  switchUI(AppUIState.MENU); // All cleanup centralized in switchUI
};

const sideArtLeftCanvas = document.getElementById(
  'side-art-left',
) as HTMLCanvasElement;
const sideArtRightCanvas = document.getElementById(
  'side-art-right',
) as HTMLCanvasElement;
const sideArt = new SideArt(sideArtLeftCanvas, sideArtRightCanvas, canvas);

// Scores & leaderboard client (talks to Go control service)
const scoresClient = new ScoresClient(
  import.meta.env.VITE_OSD_CONTROL_URL ||
    window.location.origin.replace(/\/[^/]*$/, ''),
);
const passcodeClient = new PasscodeClient(
  import.meta.env.VITE_OSD_CONTROL_URL || window.location.origin,
);
const friendsManager = new FriendsManager(identity.id, identity.callSign);
const telemetry = new TelemetryCollector(
  identity.id,
  import.meta.env.VITE_OSD_CONTROL_URL || window.location.origin,
);
// Session start & return visit tracking (lightweight — just a cookie)
(function emitSessionStart() {
  const VISIT_KEY = 'osd_first_visit';
  const prev = localStorage.getItem(VISIT_KEY);
  const now = Date.now().toString();
  telemetry.emit(
    prev ? 'return_visit' : 'session_start',
    '',
    0,
    undefined,
    undefined,
  );
  // Also emit a numeric gap if returning (days since last visit)
  if (prev) {
    const daysAgo = Math.round((Date.now() - parseInt(prev, 10)) / 86400000);
    telemetry.emit('return_visit', '', 0, undefined, daysAgo);
  }
  localStorage.setItem(VISIT_KEY, now);
})();
const currentDuelMeta = { duelId: '', opponentType: '' };

function updateResponsiveChrome() {
  const isPortrait = window.innerHeight > window.innerWidth;
  joypad.setOrientation(isPortrait);
  sideArt.resize();
}

window.addEventListener('resize', updateResponsiveChrome);
window.addEventListener('orientationchange', updateResponsiveChrome);
updateResponsiveChrome();

const keyboard = new KeyboardInput();
const gamepad = new GamepadInput();

const UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_POLL_JITTER_MS = 30_000; // ±30s jitter to avoid thundering herd
const UPDATE_POLL_MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 min cap on backoff
let updateCheckInFlight = false;
let promptVersion: string | null = null;
let updateBackoffMs = UPDATE_POLL_INTERVAL_MS;

function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const delta = (left[i]! ?? 0) - (right[i]! ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function reloadForUpdate(latestVersion: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('update', latestVersion);
  url.hash = '';
  window.location.assign(url.toString());
}

function showUpdateAvailable(latestVersion: string) {
  if (promptVersion === latestVersion) return;
  promptVersion = latestVersion;
  recordTrace('app:update-available', {
    currentVersion: __APP_VERSION__,
    latestVersion,
  });
  gameLoop.stop();
  musicManager?.stop();
  overlay.showUpdateAvailable(__APP_VERSION__, latestVersion, () =>
    reloadForUpdate(latestVersion),
  );
}

async function checkForAppUpdate(force: boolean = false) {
  if (updateCheckInFlight && !force) return;
  updateCheckInFlight = true;

  try {
    const versionUrl = new URL(
      'version.json',
      `${window.location.origin}${import.meta.env.BASE_URL}`,
    );
    versionUrl.searchParams.set('ts', String(Date.now()));
    const response = await fetch(versionUrl.toString(), {
      cache: 'no-store',
    });
    if (!response.ok) return;

    const payload = (await response.json()) as { version?: string };
    const latestVersion =
      typeof payload.version === 'string' ? payload.version : '';
    if (!latestVersion) return;

    if (compareVersions(latestVersion, __APP_VERSION__) > 0) {
      showUpdateAvailable(latestVersion);
    } else if (promptVersion === latestVersion) {
      promptVersion = null;
      overlay.hideUpdateAvailable();
    }
    // Reset backoff on success
    updateBackoffMs = UPDATE_POLL_INTERVAL_MS;
  } catch {
    // Exponential backoff on failure — double interval up to 30 min cap
    updateBackoffMs = Math.min(updateBackoffMs * 2, UPDATE_POLL_MAX_BACKOFF_MS);
  } finally {
    updateCheckInFlight = false;
  }
}

mainMenu.soundEnabled = soundEnabled;
mainMenu.callSign = identity.callSign;
mainMenu.version = __APP_VERSION__;

netManager.onStatusUpdate = (status) => {
  mainMenu.updateConnectionStatus(status);
};

netManager.onStateReceived = (receivedState) => {
  state = receivedState;
  recordTrace('net:state-received', {
    remoteTick: receivedState.tick,
    entityCount: receivedState.entities.length,
  });
  if (netManager.role === 'guest') {
    switchUI(AppUIState.GAME);
  }
};

netManager.onHandshakeComplete = () => {
  recordTrace('net:handshake-complete', { role: netManager.role });
  // Route scores/leaderboard requests through peer connection
  scoresClient.setProxy({
    sendControl: (m) => netManager.sendControl(m),
    baseUrl: '',
  });
  lobby.stopHosting();
  if (netManager.role === 'host') {
    startRound(true);
  } else if (netManager.role === 'guest') {
    mainMenu.hide();
  }
};

netManager.onHandshakeFailed = (reason) => {
  recordTrace('net:handshake-failed', { reason });
  alert(`SYNC FAILED: ${reason}`);
  enterMenuState(); // switchUI(MENU) handles all cleanup centrally
};

// Peer-v1 (server-peer) join callbacks
netManager.onPeerV1JoinAccepted = (result) => {
  recordTrace('net:peer-v1-join-accepted', {
    duelId: result.duelId,
    seed: result.seed,
    ruleset: result.ruleset,
  });
  // Route scores/leaderboard through peer connection
  scoresClient.setProxy({
    sendControl: (m) => netManager.sendControl(m),
    baseUrl: '',
  });
  lobby.stopHosting();
  // Create state from the server's seed/ruleset
  state = createInitialState(WORLD_WIDTH, WORLD_HEIGHT, result.seed, 1);
  state.playerShipClasses[netManager.localPlayerId] =
    mainMenu.selectedShipClass;
  state.playerCustomizations[netManager.localPlayerId] =
    getLocalCustomization();
  state.settings.waveCompositions = [...mainMenu.waveCompositions];
  state.scoreMultiplier = mainMenu.calculateMultiplier();

  // Host (server-peer) handles state; we just wait for first StateFrame
  mainMenu.hide();
  switchUI(AppUIState.GAME);
};

netManager.onPeerV1JoinRejected = (reason, message) => {
  recordTrace('net:peer-v1-join-rejected', { reason, message });
  alert(message || `SERVER REJECTED: ${reason}`);
  enterMenuState();
};

netManager.onTauntReceived = (emoji: string) => {
  playSound(tauntSoundFor(emoji));
};

netManager.onScoresResponse = (msg) => {
  scoresClient.onScoresResponse(msg);
};

mainMenu.onCancel = () => {
  recordTrace('ui:cancel');
  enterMenuState();
};

mainMenu.onShowLeaderboard = async () => {
  recordTrace('ui:leaderboard-opened');
  const entries = await scoresClient.leaderboard(25);
  mainMenu.showLeaderboard(entries, () => {
    sideArt.resize();
    mainMenu.show();
  });
};

let spectateView: SpectateView | null = null;
let spectateClient: SpectateClient | null = null;

function cleanupSpectate() {
  spectateClient?.disconnect();
  spectateClient = null;
  spectateView?.hide();
  spectateView = null;
}

mainMenu.onWatchDuel = (duelId, strategy) => {
  cleanupSpectate();
  recordTrace('ui:watch-duel', { duelId, strategy });

  spectateView = new SpectateView(
    canvas,
    document.getElementById('ui-layer') || document.body,
  );
  spectateView.onLeave = () => {
    switchUI(AppUIState.MENU);
  };

  spectateClient = new SpectateClient(
    duelId,
    joinNostr as unknown as (c: Record<string, unknown>, r: string) => any,
  );
  spectateClient.onStateUpdate = (s) => spectateView?.onState(s);
  spectateClient.onGameOver = (e) => spectateView?.onGameOver(e);
  spectateClient.connect();

  spectateView.show();
  mainMenu.hide();
};

mainMenu.onRegenerateCallSign = () => {
  const newCallSign = regenerateCallSign();
  identity.callSign = newCallSign;
  netManager.localCallSign = newCallSign;
  return newCallSign;
};

mainMenu.onSoundToggle = (enabled) => {
  soundEnabled = enabled;
  mainMenu.soundEnabled = enabled;
  telemetry.emit('sound_toggle', '', 0, enabled ? 'on' : 'off', undefined);
  localStorage.setItem(PERSIST_SOUND_KEY, String(enabled));
  if (!enabled) {
    musicManager?.stop();
    return;
  }
  syncMusicScene();
  startMusicPlayback();
};

mainMenu.onMusicIntensityProfileChange = () => {
  if (!soundEnabled || !audioUnlocked) return;
  syncMusicScene();
  musicManager?.stop();
  startMusicPlayback();
};

// ── Passcode callbacks ────────────────────────────────────────────

mainMenu.onCreatePasscode = async (roomId, strategy, hostName) => {
  const entry = await passcodeClient.create(roomId, strategy, hostName);
  return entry?.code ?? null;
};

mainMenu.onResolvePasscode = async (code) => {
  const entry = await passcodeClient.resolve(code);
  if (!entry) return null;
  telemetry.emit('passcode_resolve', '', 0, entry.strategy, undefined);
  return { roomId: entry.roomId, strategy: entry.strategy };
};

mainMenu.onCopyDuelLink = (link) => {
  try {
    navigator.clipboard.writeText(link);
    // Brief visual feedback handled by browser
  } catch {
    /* clipboard API unavailable */
  }
};

mainMenu.onShareDuelLink = (link) => {
  if (navigator.share) {
    navigator
      .share({ title: 'Open Space Duel', text: 'Join my duel!', url: link })
      .catch((err) => console.warn('[share]', err));
  } else {
    // Fallback: copy to clipboard
    mainMenu.onCopyDuelLink?.(link);
  }
};

// ── Friends callbacks ─────────────────────────────────────────────

mainMenu.onAddFriend = (playerId, callSign) => {
  friendsManager.addFriend(playerId, callSign || 'Friend');
  mainMenu.renderFriends(friendsManager.getFriends());
  telemetry.emit('friend_add', '', 0, undefined, undefined);
};

mainMenu.onRemoveFriend = (playerId) => {
  friendsManager.removeFriend(playerId);
  mainMenu.renderFriends(friendsManager.getFriends());
};

mainMenu.onCopyFriendCode = (code) => {
  try {
    navigator.clipboard.writeText(code);
  } catch {
    /* unavailable */
  }
};

mainMenu.onShareFriendCode = (code) => {
  const url = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}?addFriend=${encodeURIComponent(code)}`;
  const text = `Add me on Open Space Duel! 🛸 My friend code: ${code}`;
  if (typeof navigator.share === 'function') {
    navigator
      .share({ title: 'Open Space Duel', text, url })
      .catch((err) => console.warn('[share]', err));
  } else {
    // Fallback: copy deep link to clipboard
    navigator.clipboard
      .writeText(url)
      .catch((err) => console.warn('[clipboard]', err));
  }
};

mainMenu.onInviteFriend = async (friendId) => {
  try {
    // Host a duel and send invite to the friend
    const shipClass = 'standard';
    const roomId = crypto.randomUUID().replace(/-/g, '').substring(0, 12);

    enterLobbyState();
    mainMenu.showLobbyStatus(
      'SENDING INVITE...',
      'Your friend will be notified to join your duel.',
    );

    netManager.role = 'host';
    netManager.initTrystero({ strategy: 'nostr', roomId });
    lobby.startHosting(roomId, 'nostr', shipClass, identity.callSign);
    friendsManager.sendDuelInvite(friendId, roomId);

    mainMenu.showLobbyStatus(
      'INVITE SENT ✉️',
      'Waiting for your friend to accept the duel...',
    );
  } catch (e) {
    console.error('[Friends] Failed to send invite:', e);
  }
};

// Wire friends manager updates to menu
friendsManager.onFriendListUpdate = (friends) => {
  mainMenu.renderFriends(friends);
};
mainMenu.setFriendCode(friendsManager.getMyFriendCode());
mainMenu.renderFriends(friendsManager.getFriends());

// ── Incoming duel invite notification ─────────────────────────────
friendsManager.onDuelInvite = (friendId, friendName) => {
  const cleanName = friendName || friendId.substring(0, 8);
  overlay.showDuelInvite(
    cleanName,
    // Accept: join the duel room
    () => {
      const roomId = friendId; // friendId IS the duelId in the invite
      enterLobbyState();
      mainMenu.showLobbyStatus(
        'JOINING DUEL...',
        'Connecting to the duel arena. Please wait.',
      );
      netManager.role = 'guest';
      netManager.initTrystero({ strategy: 'nostr', roomId });
      lobby.stopHosting(); // Ensure we're not also hosting
    },
    // Decline: do nothing
    () => {
      console.debug('[Friends] Duel invite declined');
    },
  );
};

function getLocalCustomization(): ShipCustomization {
  return { statFocus: mainMenu.statFocus };
}

function handleCollisionSound(
  _pos: { x: number; y: number },
  strength: number,
  isDramatic?: boolean,
) {
  renderer.triggerShake(strength);
  if (isDramatic) {
    playSound('explosionDramatic');
  } else {
    playSound('explosion');
  }
}

function detectLocalMultiplayerCapability(): boolean {
  // Don't support multi-user on mobile per user request
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isMobile) return false;

  // Desktop duel play is a keyboard-first flow; gamepad presence should not
  // hide the option because browsers disagree on when they expose connected pads.
  return true;
}

mainMenu.localMultiplayerPossible = detectLocalMultiplayerCapability();

window.addEventListener('gamepadconnected', () => {
  mainMenu.localMultiplayerPossible = detectLocalMultiplayerCapability();
  mainMenu.renderInitialMenu();
});
window.addEventListener('gamepaddisconnected', () => {
  mainMenu.localMultiplayerPossible = detectLocalMultiplayerCapability();
  mainMenu.renderInitialMenu();
});

enum AppUIState {
  MENU,
  LOBBY,
  GAME,
  DISCONNECTED,
}

let currentUIState = AppUIState.MENU;

function syncMusicScene() {
  if (!musicManager) return;
  musicManager.setIntensityProfile(mainMenu.musicIntensityProfile);

  if (currentUIState === AppUIState.MENU) {
    musicManager.setComposition(CompositionType.MainMenu);
    musicManager.setIntensity(0.1);
    musicManager.setDifficulty(0);
    return;
  }

  if (!state) return;

  const activeCount = state.entities.reduce((count, ent) => {
    if (!ent.isActive) return count;
    return ent.type === 'asteroid' || ent.type === 'projectile'
      ? count + 1
      : count;
  }, 0);

  const intensity = Math.min(1.0, activeCount / 20.0);
  const waveIndex = (state.wave - 1) % state.settings.waveCompositions.length;
  const compType = state.settings.waveCompositions[
    waveIndex
  ] as CompositionType;

  musicManager.setIntensity(intensity);
  musicManager.setComposition(compType);
  musicManager.setDifficulty(state.wave);
}

function enterMenuState() {
  friendsManager.start(); // Start friends presence so QR/share/invite works on menu
  switchUI(AppUIState.MENU);
}

function enterLobbyState() {
  switchUI(AppUIState.LOBBY);
}

function switchUI(newState: AppUIState) {
  recordTrace('ui:switch', {
    from: AppUIState[currentUIState]!,
    to: AppUIState[newState]!,
  });
  currentUIState = newState;

  // ── Centralized cleanup for transitions out of game/spectate ──
  // Ensures spectate, network, and game state are torn down
  // regardless of which code path initiated the transition.
  if (newState === AppUIState.MENU || newState === AppUIState.LOBBY) {
    cleanupSpectate();
  }
  if (newState === AppUIState.MENU) {
    scoresClient.clearProxy();
    netManager.close();
    lobby.stopHosting();
    friendsManager.stop();
    state = undefined;
    isLocalMultiplayer = false;
    joypad.resetTilt();
    if (!gameLoop.active) gameLoop.start();
  }

  // Hide all by default
  mainMenu.hide();
  hud.hide();
  joypad.disable();

  switch (newState) {
    case AppUIState.MENU:
      sideArt.resize();
      mainMenu.soundEnabled = soundEnabled;
      syncMusicScene();
      mainMenu.show();
      if (soundEnabled && audioUnlocked) musicManager?.start();
      overlay.setDisconnected(false);
      break;
    case AppUIState.LOBBY:
      mainMenu.show();
      overlay.setDisconnected(false);
      break;
    case AppUIState.GAME:
      sideArt.resize();
      hud.show();
      joypad.enable();
      syncMusicScene();
      if (soundEnabled && audioUnlocked) musicManager?.start();
      overlay.setDisconnected(false);
      break;
    case AppUIState.DISCONNECTED:
      overlay.show();
      overlay.setDisconnected(true);
      break;
  }
}

function mergeInputs(pIndex: number = 0): PlayerInput {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const activeGamepads = Array.from(gamepads).filter((gp) => gp !== null);

  let gInput: PlayerInput | null = null;
  let jInput: PlayerInput | null = null;
  let kInput: PlayerInput | null = null;

  if (isLocalMultiplayer) {
    if (activeGamepads.length >= 2) {
      // 2+ Gamepads: GP0 vs GP1
      gInput = gamepad.getInput(pIndex);
      // Joypad/Keyboard only for P1
      if (pIndex === 0) {
        jInput = joypad.getInput();
        kInput = keyboard.getInput(0, true);
      } else {
        kInput = keyboard.getInput(1, true);
      }
    } else if (activeGamepads.length === 1) {
      // 1 Gamepad: Keyboard/Joypad vs GP0
      if (pIndex === 0) {
        jInput = joypad.getInput();
        kInput = keyboard.getInput(0, true);
      } else {
        gInput = gamepad.getInput(0);
        kInput = keyboard.getInput(1, true);
      }
    } else {
      // 0 Gamepads: P1 uses Keyboard/Joypad
      if (pIndex === 0) {
        jInput = joypad.getInput();
        kInput = keyboard.getInput(0, true);
      } else {
        kInput = keyboard.getInput(1, true);
      }
    }
  } else {
    // Standard merged inputs for Solo/Networked
    gInput = gamepad.getInput(0);
    jInput = joypad.getInput();
    kInput = keyboard.getInput();
  }

  return {
    thrust: gInput?.thrust || jInput?.thrust || kInput?.thrust || false,
    left: gInput?.left || jInput?.left || kInput?.left || false,
    right: gInput?.right || jInput?.right || kInput?.right || false,
    fire: gInput?.fire || jInput?.fire || kInput?.fire || false,
    fireSecondary:
      gInput?.fireSecondary ||
      jInput?.fireSecondary ||
      kInput?.fireSecondary ||
      false,
    shield: gInput?.shield || jInput?.shield || kInput?.shield || false,
    pause: gInput?.pause || jInput?.pause || kInput?.pause || false,
    targetRotation: gInput?.targetRotation ?? jInput?.targetRotation,
    customization: getLocalCustomization(),
  };
}

const gameLoop = new GameLoop(
  (dt) => {
    const p1Input = mergeInputs(0);
    const p2Input = mergeInputs(1);

    if (!state) {
      mainMenu.update(p1Input, p2Input);
      return;
    }

    if (state.isGameOver) return;

    // Heartbeat check for networked games
    if (currentUIState === AppUIState.GAME && netManager.role !== 'local') {
      const now = Date.now();
      if (now - netManager.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        gameLoop.stop();
        switchUI(AppUIState.DISCONNECTED);
        return;
      }
    }

    const localInput = p1Input;

    // Pause handling
    if (localInput.pause && !lastPausePressed) {
      state.isPaused = !state.isPaused;
      if (state.isPaused) {
        musicManager?.setIntensity(0); // Quiet music when paused
      } else {
        // Reset intensity will be handled by the render callback
      }
    }
    lastPausePressed = !!localInput.pause;

    if (state.isPaused) return;

    if (netManager.role === 'guest') {
      netManager.sendInput(localInput);
    } else {
      const inputs: { [id: string]: PlayerInput } = {
        [netManager.localPlayerId]: localInput,
      };

      if (isLocalMultiplayer) {
        inputs['local_p2'] = p2Input;
      }

      if (netManager.role === 'host') {
        const rInput = netManager.consumeRemoteInput();
        inputs[netManager.remotePlayerId] = rInput;
        if (rInput.customization) {
          state.playerCustomizations[netManager.remotePlayerId] =
            rInput.customization;
        }
      }

      updatePhysics(
        state,
        inputs,
        dt,
        (type: 'thrust' | 'fire' | 'shield' | 'depleted' | 'respawn' | 'emp') =>
          playSound(type),
      );
      checkCollisions(state, handleCollisionSound);

      if (netManager.role === 'host') {
        netManager.sendState(state);
      }
    }
  },
  () => {
    if (!state) return;

    renderer.render(state, netManager.localPlayerId);

    // Taunt handler — sends emoji to opponent and plays sound
    const handleTaunt = (emoji: string) => {
      netManager.sendTaunt(emoji);
      playSound(tauntSoundFor(emoji));
    };

    if (netManager.role === 'guest') {
      const hostId =
        Object.keys(state.playerCallSigns || {}).find(
          (id) => id !== netManager.localPlayerId,
        ) || netManager.remotePlayerId;
      hud.update(
        state,
        netManager.localPlayerId,
        hostId,
        soundEnabled,
        () => {
          soundEnabled = !soundEnabled;
          mainMenu.soundEnabled = soundEnabled;
          localStorage.setItem('osd_sound_enabled', String(soundEnabled));
          if (soundEnabled && !state?.isPaused) {
            syncMusicScene();
            startMusicPlayback();
          } else musicManager?.stop();
        },
        handleTaunt,
        false,
      );
      overlay.update(state, netManager.role, netManager.localPlayerId);
    } else {
      hud.update(
        state,
        netManager.localPlayerId,
        netManager.role === 'local' ? null : netManager.remotePlayerId,
        soundEnabled,
        () => {
          soundEnabled = !soundEnabled;
          mainMenu.soundEnabled = soundEnabled;
          localStorage.setItem('osd_sound_enabled', String(soundEnabled));
          if (soundEnabled && !state?.isPaused) {
            syncMusicScene();
            startMusicPlayback();
          } else musicManager?.stop();
        },
        handleTaunt,
        isLocalMultiplayer,
      );
      overlay.update(state, netManager.role, netManager.localPlayerId);
    }

    if (!state.isGameOver) {
      let hasSnake = false;
      let hasSaucer = false;

      for (const ent of state.entities) {
        if (!ent.isActive) continue;
        if (ent.type === 'spaceSnake') hasSnake = true;
        if (ent.type === 'saucer') hasSaucer = true;
      }

      // Update music to match the active duel scene.
      syncMusicScene();

      // NPC Sounds
      if (hasSnake && state.tick % 10 === 0) playSound('snakeMove');
      if (hasSaucer && state.tick % 20 === 0) playSound('saucerMove');
    } else {
      if (netManager.role === 'host') {
        netManager.sendState(state);
      }
      gameLoop.stop();

      let matchWinner: string | null = null;
      const playerIds = Object.keys(state.lives);

      if (playerIds.length > 1) {
        for (const pId of playerIds) {
          if (state.lives[pId]! > 0) {
            matchWinner = pId;
            state.seriesWins[pId]! = (state.seriesWins[pId]! || 0) + 1;
            break;
          }
        }

        if (
          matchWinner &&
          state.seriesWins[matchWinner]! < state.requiredWins
        ) {
          mainMenu.showGameOver(state.score, state.playerCallSigns, null, () =>
            startRound(false),
          );
          recordTrace('game:round-over', {
            playerCount: playerIds.length,
            matchWinner,
            requiredWins: state.requiredWins,
          });
          return;
        }
      }

      recordTrace('game:over', {
        playerCount: playerIds.length,
        matchWinner,
        requiredWins: state.requiredWins,
      });

      // Submit scores to leaderboard
      const localId = netManager.localPlayerId;
      const localScore = state.score[localId]! ?? 0;
      scoresClient
        .submitScore({
          duelId: currentDuelMeta.duelId || `local_${crypto.randomUUID()}`,
          playerId: localId,
          playerName: identity.callSign,
          score: localScore,
          mode: netManager.role === 'local' ? 'survival' : 'duel',
          shipType: mainMenu.selectedShipClass,
          botPersonality: currentDuelMeta.opponentType || undefined,
          won: matchWinner === localId,
          wavesCompleted: state.wave,
          ticks: state.tick,
        })
        .catch((err) => console.warn('[catch]', err));

      telemetry.incrementSessionGames();
      telemetry.emit(
        'game_end',
        currentDuelMeta.duelId,
        state.tick,
        netManager.role === 'local' ? 'survival' : 'duel',
        localScore,
      );
      telemetry.emit(
        'ship_select',
        currentDuelMeta.duelId,
        0,
        mainMenu.selectedShipClass,
        undefined,
      );
      telemetry.flush(); // send accumulated events

      mainMenu.showGameOver(
        state.score,
        state.playerCallSigns,
        matchWinner,
        returnToBase,
        (rating) => {
          scoresClient
            .submitFeedback({
              duelId: currentDuelMeta.duelId || `local_${crypto.randomUUID()}`,
              playerId: localId,
              rating,
              tags: [],
            })
            .catch((err) => console.warn('[catch]', err));
        },
      );
    }
  },
);

function returnToBase() {
  recordTrace('ui:return-to-base');
  switchUI(AppUIState.MENU); // All cleanup centralized in switchUI
}

function startRound(resetSeries: boolean) {
  recordTrace('round:start-requested', {
    resetSeries,
    role: netManager.role,
    localMultiplayer: isLocalMultiplayer,
  });
  telemetry.emit(
    'game_start',
    currentDuelMeta.duelId,
    0,
    netManager.role,
    undefined,
  );
  const players = [netManager.localPlayerId];
  const callSigns: { [id: string]: string } = {
    [netManager.localPlayerId]: identity.callSign || 'PILOT 1',
  };

  if (netManager.role !== 'local') {
    players.push(netManager.remotePlayerId);
    callSigns[netManager.remotePlayerId] = netManager.remoteCallSign;
  } else if (isLocalMultiplayer) {
    players.push('local_p2');
    callSigns['local_p2'] = 'PILOT 2';
  }

  const customizations: { [id: string]: ShipCustomization } = {};
  const shipClasses: { [id: string]: ShipClass } = {};
  players.forEach((pId) => {
    customizations[pId] = state?.playerCustomizations[pId] ?? { statFocus: 0 };
    shipClasses[pId] = state?.playerShipClasses[pId] ?? ShipClass.Standard;
  });

  // Persist totals if not resetting the whole series
  const oldWins = state?.seriesWins || {};
  const oldLives = state?.lives || {};
  const oldScore = state?.score || {};
  const oldWave = state?.wave || 1;
  const oldSettings = state?.settings;
  const req = state?.requiredWins || 1;

  const nextState = createInitialState(
    WORLD_WIDTH,
    WORLD_HEIGHT,
    Date.now(),
    req,
  );
  nextState.playerCustomizations = customizations;
  nextState.playerShipClasses = shipClasses;
  nextState.playerCallSigns = callSigns;
  if (oldSettings) nextState.settings = oldSettings;

  if (!resetSeries) {
    nextState.seriesWins = oldWins;
    nextState.lives = oldLives;
    nextState.score = oldScore;
    nextState.wave = oldWave;
  } else {
    players.forEach((pId) => {
      nextState.lives[pId]! = 3;
      nextState.score[pId]! = 0;
    });
    nextState.wave = 1;
  }

  // Spawn players
  players.forEach((pId, idx) => {
    // Only spawn if they still have lives left
    if ((nextState.lives[pId]! || 0) <= 0) return;

    let x = idx === 0 ? 100 : WORLD_WIDTH - 100;
    if (netManager.role === 'local' && !isLocalMultiplayer) {
      x = WORLD_WIDTH / 2;
    }
    nextState.entities.push(
      createShip(
        x,
        WORLD_HEIGHT / 2,
        pId,
        nextState.playerShipClasses[pId]!,
        undefined,
        nextState.playerCustomizations[pId]!,
      ),
    );
  });

  // Spawn asteroids (seeded PRNG for determinism)
  const initRng = new DeterministicRNG(nextState.prngState);
  for (let i = 0; i < nextState.settings.asteroidDensity * 2; i++) {
    nextState.entities.push(
      createAsteroid(
        initRng.next() * WORLD_WIDTH,
        initRng.next() * WORLD_HEIGHT,
        (initRng.next() - 0.5) * 100,
        (initRng.next() - 0.5) * 100,
        20 + initRng.next() * 20,
      ),
    );
  }
  nextState.prngState = initRng.currentState;

  state = nextState;
  recordTrace('round:started', {
    resetSeries,
    players: players.length,
    entityCount: state.entities.length,
  });
  switchUI(AppUIState.GAME);
  gameLoop.start();
}

// Menu Callbacks
mainMenu.onStartLocal = (shipClass) => {
  recordTrace('game:start-local', { shipClass });
  currentDuelMeta.duelId = `local_${crypto.randomUUID()}`;
  currentDuelMeta.opponentType = '';
  isLocalMultiplayer = false;
  lobby.close();
  netManager.role = 'local';

  state = createInitialState(WORLD_WIDTH, WORLD_HEIGHT, Date.now(), 999);
  state.playerCustomizations[netManager.localPlayerId] =
    getLocalCustomization();
  state.playerShipClasses[netManager.localPlayerId] = shipClass;

  // Apply Match Settings
  state.settings = {
    boostersEnabled: mainMenu.boostersEnabled,
    boosterRate: mainMenu.boosterRate,
    asteroidDensity: mainMenu.asteroidDensity,
    hazardsEnabled: mainMenu.hazardsEnabled,
    screenShake: mainMenu.screenShake,
    gameSpeed: mainMenu.gameSpeed,
    unlimitedEnergy: mainMenu.unlimitedEnergy,
    waveCompositions: [...mainMenu.waveCompositions],
  };
  state.scoreMultiplier = mainMenu.calculateMultiplier();

  startRound(true);
};

mainMenu.onStartLocalMultiplayer = (
  p1Class,
  p1Stat,
  p2Class,
  p2Stat,
  requiredWins,
) => {
  recordTrace('game:start-local-multiplayer', {
    p1Class,
    p2Class,
    requiredWins,
  });
  isLocalMultiplayer = true;
  lobby.close();
  netManager.role = 'local';

  state = createInitialState(
    WORLD_WIDTH,
    WORLD_HEIGHT,
    Date.now(),
    requiredWins,
  );
  state.playerCustomizations[netManager.localPlayerId] = { statFocus: p1Stat };
  state.playerCustomizations['local_p2'] = { statFocus: p2Stat };
  state.playerShipClasses[netManager.localPlayerId] = p1Class;
  state.playerShipClasses['local_p2'] = p2Class;

  // Apply Match Settings
  state.settings = {
    boostersEnabled: mainMenu.boostersEnabled,
    boosterRate: mainMenu.boosterRate,
    asteroidDensity: mainMenu.asteroidDensity,
    hazardsEnabled: mainMenu.hazardsEnabled,
    screenShake: mainMenu.screenShake,
    gameSpeed: mainMenu.gameSpeed,
    unlimitedEnergy: mainMenu.unlimitedEnergy,
    waveCompositions: [...mainMenu.waveCompositions],
  };
  state.scoreMultiplier = mainMenu.calculateMultiplier();

  startRound(true);
};

mainMenu.onHostGame = async (strategy, shipClass, requiredWins) => {
  try {
    recordTrace('net:host-requested', { strategy, shipClass, requiredWins });
    telemetry.emit('host_game', '', 0, strategy, undefined);
    telemetry.emit('ship_select', '', 0, shipClass, undefined);
    netManager.role = 'host';
    state = createInitialState(
      WORLD_WIDTH,
      WORLD_HEIGHT,
      Date.now(),
      requiredWins,
    );
    state.playerShipClasses[netManager.localPlayerId] = shipClass;
    state.playerCustomizations[netManager.localPlayerId] =
      getLocalCustomization();
    state.settings.waveCompositions = [...mainMenu.waveCompositions];

    if (strategy === 'manual') {
      if (typeof RTCPeerConnection === 'undefined') {
        alert('Private duel links are not available in this browser.');
        telemetry.emit(
          'webrtc_fail',
          '',
          0,
          'RTCPeerConnection_undefined',
          undefined,
        );
        return;
      }
      enterLobbyState();
      mainMenu.showWaitingForGuest('', true, true);
      netManager.initWebRTC();
      if (netManager.webrtc) {
        const offer = await netManager.webrtc.createOffer();
        const inviteLink = createInviteLink(offer);
        recordTrace('net:manual-offer-created');
        mainMenu.showWaitingForGuest(inviteLink, true, false);
        // Show QR code on the DUEL ARENA card
        mainMenu.showDuelLink(inviteLink, null);
        // Create a passcode for easy sharing
        try {
          const roomId = generateId();
          const pc = await passcodeClient.create(
            roomId,
            'nostr',
            identity.callSign,
          );
          if (pc) {
            mainMenu.showDuelLink(inviteLink, pc.code);
            telemetry.emit('passcode_create', '', 0, 'nostr', undefined);
          }
        } catch {
          /* passcode creation is best-effort */
        }
      }
    } else {
      // Trystero/Public strategy
      enterLobbyState();
      mainMenu.showLobbyStatus(
        'BEACONING THE DUEL ARENA...',
        'Your duel is visible in the public duel arena. No link is required.',
      );
      const roomId = generateId();
      try {
        netManager.initTrystero({ strategy, roomId });
        lobby.startHosting(roomId, strategy, shipClass, identity.callSign);
      } catch (e) {
        console.error(e);
        mainMenu.showLobbyStatus(
          'DUEL ARENA UNAVAILABLE',
          'This browser cannot beacon a public duel arena.',
        );
      }
    }
  } catch (e) {
    console.error(e);
  }
};

mainMenu.onJoinGame = (invite) => {
  recordTrace('net:join-link-submitted');
  const result = parseLinkPayload(invite);
  if (result) {
    const hashIndex = invite.indexOf('#');
    window.location.hash =
      hashIndex >= 0 ? invite.slice(hashIndex) : `#${invite}`;
  } else {
    // Invalid or expired link — show message, then redirect
    showExpiredLinkNotice();
  }
};

mainMenu.onJoinDiscoveredGame = (roomId, strategy) => {
  recordTrace('net:join-discovered-requested', { roomId, strategy });
  enterLobbyState();
  mainMenu.showLobbyStatus(
    'ENTERING THE DUEL ARENA...',
    'Joining the public duel arena. Please wait for the handshake to complete.',
  );
  try {
    netManager.role = 'guest';
    netManager.initTrystero({ strategy, roomId });
  } catch (e) {
    console.error(e);
    mainMenu.showLobbyStatus(
      'DUEL ARENA UNAVAILABLE',
      'This browser cannot join a public duel arena.',
    );
  }
};

mainMenu.onJoinServerDuel = (
  duelId,
  roomId,
  strategy,
  inviteCode,
  turnUrls,
  turnUsername,
  turnCredential,
) => {
  // Fallback TURN: if the server-peer didn't advertise TURN credentials
  // (e.g. Trystero transport stripping), use Open Relay free TURN.
  const effectiveTurnUrls =
    turnUrls && turnUrls.length > 0
      ? turnUrls
      : [
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ];
  const effectiveTurnUser = turnUsername || 'openrelayproject';
  const effectiveTurnCred = turnCredential || 'openrelayproject';

  recordTrace('net:join-server-duel-requested', {
    duelId,
    roomId,
    strategy,
    hasCode: !!inviteCode,
    hasTurn: !!effectiveTurnUrls?.length,
  });
  currentDuelMeta.duelId = duelId;
  currentDuelMeta.opponentType = 'bot';
  if (effectiveTurnUrls?.length)
    telemetry.emit(
      'relay_configured',
      duelId,
      0,
      strategy,
      effectiveTurnUrls.length,
    );

  try {
    enterLobbyState();
    mainMenu.showLobbyStatus(
      'CONNECTING TO ARENA...',
      'Joining the server-hosted duel. Handshaking with the arena peer...',
    );

    netManager.role = 'guest';
    netManager.initTrystero({
      strategy,
      roomId,
      turnUrls: effectiveTurnUrls,
      turnUsername: effectiveTurnUser,
      turnCredential: effectiveTurnCred,
    });
    netManager.initPeerV1Join(
      duelId,
      mainMenu.selectedShipClass,
      1,
      inviteCode,
    );
  } catch (e) {
    console.error('[JOIN]', e);
    mainMenu.showLobbyStatus(
      'CONNECTION FAILED',
      'Could not connect to the arena. Check your network and try again.',
    );
  }
};

mainMenu.onAcceptResponse = async (payload) => {
  recordTrace('net:response-submitted');
  const result = parseLinkPayload(payload);
  if (result && result.type === 'response' && netManager.webrtc) {
    try {
      const msg = result.payload as SignalingMessage;
      await netManager.webrtc.handleAnswer(msg.sdp);
    } catch {
      showExpiredLinkNotice();
    }
  } else {
    showExpiredLinkNotice();
  }
};

/** Show a brief "link expired" notice, then redirect to the base game page. */
function showExpiredLinkNotice(): void {
  // Prevent multiple overlays
  if (document.getElementById('expired-link-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'expired-link-overlay';
  overlay.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:monospace;';
  overlay.innerHTML =
    '<div style="font-size:48px;margin-bottom:16px;">⏳</div>' +
    '<h2 style="color:#ff6688;margin:0 0 8px;font-size:22px;">LINK EXPIRED</h2>' +
    '<p style="color:#888;font-size:13px;margin:0 0 20px;text-align:center;max-width:300px;">This duel invitation is no longer valid.<br>The host may have disconnected or the link has timed out.</p>' +
    '<button id="expired-link-btn" style="padding:12px 32px;background:#ffcc00;color:#000;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;">GO TO GAME</button>';

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#expired-link-btn') as HTMLButtonElement;
  const redirect = () => {
    document.body.removeChild(overlay);
    window.location.hash = '';
    window.location.reload();
  };
  btn.onclick = redirect;

  // Auto-redirect after 5 seconds
  setTimeout(redirect, 5000);
}

async function handleHash() {
  const hash = window.location.hash;
  if (!hash) return;

  recordTrace('net:hash-detected');
  const result = parseLinkPayload(hash);
  if (!result) return;

  if (result.type === 'invite') {
    if (typeof RTCPeerConnection === 'undefined') {
      alert('Private duel links are not available in this browser.');
      return;
    }
    enterLobbyState();
    netManager.role = 'guest';
    netManager.initWebRTC();
    if (netManager.webrtc) {
      try {
        const msg = result.payload as SignalingMessage;
        const answer = await netManager.webrtc.handleOfferAndCreateAnswer(
          msg.sdp,
        );
        const responseLink = createResponseLink(answer);
        mainMenu.showGuestAnswering(responseLink);
      } catch {
        // Link expired or host disconnected — show message, then redirect
        showExpiredLinkNotice();
      }
    }
  } else if (result.type === 'auto_join') {
    const { strategy, roomId } = result.payload as {
      strategy: 'nostr' | 'torrent';
      roomId: string;
    };
    enterLobbyState();
    mainMenu.showLobbyStatus(
      'ENTERING THE DUEL ARENA...',
      'Joining the public duel arena. Please wait for the handshake to complete.',
    );
    try {
      netManager.role = 'guest';
      netManager.initTrystero({ strategy, roomId });
    } catch (e) {
      console.error(e);
      mainMenu.showLobbyStatus(
        'DUEL ARENA UNAVAILABLE',
        'This browser cannot join a public duel arena.',
      );
    }
  }
}

window.addEventListener('hashchange', handleHash);
handleHash();

window.addEventListener('beforeunload', () => {
  netManager.close();
  lobby.close();
});
switchUI(AppUIState.MENU);

// First-visit tutorial overlay in ordinary public builds.
{
  const TUTORIAL_KEY = 'osd_tutorial_dismissed';
  if (!localStorage.getItem(TUTORIAL_KEY)) {
    requestAnimationFrame(() => {
      overlay.showTutorial(() => {
        localStorage.setItem(TUTORIAL_KEY, Date.now().toString());
      });
    });
  }
}

gameLoop.start();

void checkForAppUpdate();
// Dynamic-schedule update poll with jitter and backoff
function scheduleNextUpdatePoll(): void {
  const jitter =
    Math.random() * UPDATE_POLL_JITTER_MS * 2 - UPDATE_POLL_JITTER_MS;
  const delay = Math.max(0, updateBackoffMs + jitter);
  window.setTimeout(() => {
    void checkForAppUpdate().finally(() => scheduleNextUpdatePoll());
  }, delay);
}
scheduleNextUpdatePoll();

// ── Global error telemetry ─────────────────────────────────────────
// Catches unhandled errors without interfering with normal error handling.
{
  const MAX_REPORTED = 10;
  let errorCount = 0;
  window.addEventListener('error', (e) => {
    if (errorCount >= MAX_REPORTED) return;
    errorCount++;
    const msg = e.message || String(e.error || 'unknown').substring(0, 200);
    telemetry.emit('game_error', '', 0, msg, undefined);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (errorCount >= MAX_REPORTED) return;
    errorCount++;
    const msg = String(e.reason || 'unknown').substring(0, 200);
    telemetry.emit('game_error', '', 0, msg, undefined);
  });
}
