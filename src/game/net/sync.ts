import { GameState, PlayerInput } from '../engine/state';
import { WebRTCConnection } from './webrtc';
import { TrysteroConnection, TrysteroConfig } from './trystero';
import {
  PeerV1Client,
  type PeerV1JoinResult,
} from '../../network/peerV1Client';
import { MAX_STATE_ENTITIES } from '../engine/worldConfig';
import {
  agreeFlightSession,
  parseFlightSessionDescriptor,
  type FlightSessionDescriptor,
} from '../flightSession';

export type NetworkRole = 'local' | 'host' | 'guest';

export interface HandshakeMessage {
  type: 'handshake';
  version: string;
  role: NetworkRole;
  callSign: string;
  session?: FlightSessionDescriptor;
}

export interface HandshakeAckMessage {
  type: 'handshake_ack';
  callSign: string;
  session?: FlightSessionDescriptor;
}

export interface InputMessage {
  type: 'input';
  input: PlayerInput;
  seq: number;
}

export interface StateMessage {
  type: 'state';
  state: GameState;
  seq: number;
}

export type NetworkMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | InputMessage
  | StateMessage;

/**
 * Validate controls from the network boundary without converting arbitrary
 * truthy strings or oversized numeric customizations into gameplay commands.
 * Invalid fields are neutral (never a free bonus, steering or weapon action).
 */
export function sanitizeInput(input: unknown): PlayerInput {
  const isPlain = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    try {
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    } catch {
      return false;
    }
  };
  const i: Record<string, unknown> = isPlain(input) ? input : {};
  const custom = isPlain(i.customization) ? i.customization : null;
  // Only JSON-owned fields can command the ship; polluted prototypes cannot.
  const bounded = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
      ? value
      : undefined;
  const focus = custom && Object.hasOwn(custom, 'statFocus')
    ? bounded(custom.statFocus, -5, 5)
    : undefined;
  // Client-supplied explicit speed/shield bonuses cannot override the
  // single shared -5..+5 stat-focus budget or grant both bonuses at once.
  // createShip derives the legitimate bonuses from this focus instead.

  return {
    thrust: Object.hasOwn(i, 'thrust') && i.thrust === true,
    left: Object.hasOwn(i, 'left') && i.left === true,
    right: Object.hasOwn(i, 'right') && i.right === true,
    fire: Object.hasOwn(i, 'fire') && i.fire === true,
    fireSecondary: Object.hasOwn(i, 'fireSecondary') && i.fireSecondary === true,
    shield: Object.hasOwn(i, 'shield') && i.shield === true,
    customization: custom
      ? {
          statFocus: focus ?? 0,
        }
      : undefined,
    targetRotation: Object.hasOwn(i, 'targetRotation')
      ? bounded(i.targetRotation, -2 * Math.PI, 2 * Math.PI)
      : undefined,
  };
}

export class NetworkManager {
  public role: NetworkRole = 'local';
  public mode: 'manual' | 'trystero' = 'manual';

  public webrtc: WebRTCConnection | null = null;
  public trystero: TrysteroConnection | null = null;

  public localPlayerId: string = 'player1';
  public remotePlayerId: string = 'player2';
  public localCallSign: string = 'PILOT';
  public remoteCallSign: string = 'PILOT 2';

  public handshakeComplete: boolean = false;
  private expectedManualSession: FlightSessionDescriptor | null = null;
  private manualHandshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private manualHandshakeAttempts = 0;
  public versionMismatch: boolean = false;
  public lastHeartbeat: number = Date.now();

  // Used by host to collect guest inputs
  private remoteInputBuffer: PlayerInput[] = [];
  private lastInput: PlayerInput = {
    thrust: false,
    left: false,
    right: false,
    fire: false,
    fireSecondary: false,
    shield: false,
  };

  // Used by guest to receive host state
  public lastReceivedState: GameState | null = null;

  public onStateReceived?: (state: GameState) => void;
  public onTrysteroConnected?: () => void;
  public onHandshakeComplete?: () => void;
  public onHandshakeFailed?: (reason: string) => void;
  public onStatusUpdate?: (status: string) => void;

  // Peer-v1 (server-peer) support
  public peerV1Client: PeerV1Client | null = null;
  public isPeerV1Game: boolean = false;
  /** Called when a peer-v1 JoinAccepted is received. */
  public onPeerV1JoinAccepted?: (result: PeerV1JoinResult) => void;
  /** Called when a peer-v1 JoinRejected is received. */
  public onPeerV1JoinRejected?: (reason: string, message?: string) => void;
  /** Called when queued (all slots full). */
  public onPeerV1JoinQueued?: (
    info: import('../../network/peerV1Client').QueueInfo,
  ) => void;
  /** Called when invited to a duel after queue wait. */
  public onPeerV1DuelInvite?: (duelId: string, message?: string) => void;
  /** Called when a taunt is received from the opponent. */
  public onTauntReceived?: (emoji: string) => void;

  private lastProcessedStateTick = -1;
  private lastProcessedInputSeq = -1;
  private currentInputSeq = 0;
  private appVersion: string = '';

  constructor(appVersion: string) {
    this.appVersion = appVersion;
  }

  /** Set the same canonical match descriptor BEFORE any manual RTC handshake. */
  public configureManualSession(value: unknown): boolean {
    const session = parseFlightSessionDescriptor(value);
    if (
      !session ||
      session.appVersion !== this.appVersion ||
      this.handshakeComplete ||
      this.isPeerV1Game ||
      this.webrtc !== null ||
      this.trystero !== null
    ) {
      return false;
    }
    this.expectedManualSession = session;
    return true;
  }

  public get manualSession(): FlightSessionDescriptor | null {
    return this.expectedManualSession ? { ...this.expectedManualSession } : null;
  }

  private rejectManualSession(reason: string): void {
    this.stopManualHandshakeRetries();
    this.handshakeComplete = false;
    this.onHandshakeFailed?.(reason);
  }

  private stopManualHandshakeRetries(): void {
    if (this.manualHandshakeTimer !== null) clearTimeout(this.manualHandshakeTimer);
    this.manualHandshakeTimer = null;
    this.manualHandshakeAttempts = 0;
  }

  /** Bounded idempotent guest hello retries on the unreliable game channel. */
  private beginManualHandshake(): void {
    this.stopManualHandshakeRetries();
    if (this.mode !== 'manual' || this.role !== 'guest') {
      this.sendHandshake();
      return;
    }
    const retry = () => {
      if (this.handshakeComplete || !this.webrtc) {
        this.stopManualHandshakeRetries();
        return;
      }
      if (this.manualHandshakeAttempts >= 5) {
        this.rejectManualSession('Manual peer ACK timeout after bounded retries');
        return;
      }
      this.manualHandshakeAttempts++;
      this.sendHandshake();
      if (!this.handshakeComplete) this.manualHandshakeTimer = setTimeout(retry, 1000);
    };
    retry();
  }

  /**
   * Called by the Host during the physics update to get the next pending input from the guest.
   * If the buffer is empty, it returns the last known input state.
   */
  public consumeRemoteInput(): PlayerInput {
    if (this.remoteInputBuffer.length > 0) {
      this.lastInput = this.remoteInputBuffer.shift()!;

      // If buffer is getting too large (lag), skip some inputs to catch up
      if (this.remoteInputBuffer.length > 5) {
        this.remoteInputBuffer.splice(0, this.remoteInputBuffer.length - 2);
      }
    }
    return this.lastInput;
  }

  public initWebRTC(lanOnly: boolean = false) {
    this.mode = 'manual';
    this.webrtc = new WebRTCConnection(lanOnly);
    this.webrtc.onStatus = (s) => this.onStatusUpdate?.(s);
    this.webrtc.onMessage = (msg: NetworkMessage) => this.handleMessage(msg);
    this.webrtc.onConnected = () => {
      this.onStatusUpdate?.('NEGOTIATING HANDSHAKE');
      // On an unreliable channel, guest repeats a bounded hello until host ACK.
      this.beginManualHandshake();
    };
    this.webrtc.onConnectionStateChange = (state) => {
      console.debug(`[SYNC] WebRTC Connection State: ${state}`);
      if (state === 'connected') {
        // Fallback for some browsers/environments
        setTimeout(() => {
          if (!this.handshakeComplete && this.role !== 'guest') {
            console.debug('[SYNC] Host retrying manual handshake hello');
            this.sendHandshake();
          }
        }, 1000);
      }
      if (state === 'failed') {
        this.onHandshakeFailed?.('WebRTC Connection Failed');
      }
    };
  }

  public initTrystero(config: TrysteroConfig) {
    this.mode = 'trystero';
    this.trystero = new TrysteroConnection(config);
    this.trystero.onInputReceived = (msg: NetworkMessage) =>
      this.handleMessage(msg);
    this.trystero.onStateReceived = (msg: NetworkMessage) =>
      this.handleMessage(msg);
    this.trystero.onControlReceived = (msg: unknown) =>
      this.handleControlMessage(msg);
    this.trystero.onConnectionStateChange = (state: string) => {
      if (state === 'connected') {
        if (this.onTrysteroConnected) this.onTrysteroConnected();
        this.onStatusUpdate?.('NEGOTIATING HANDSHAKE');
        // For peer-v1 (server-peer) games, send the join request via
        // the peerV1Client instead of the classic handshake.
        if (!this.isPeerV1Game) {
          this.sendHandshake();
        }
      }
    };
  }

  /** Handle a peer-v1 control channel message. */
  private handleControlMessage(msg: unknown): void {
    const m = msg as Record<string, unknown> | null;
    // Scores response from server-peer proxy
    if (m?.type === 'scores.response') {
      this.onScoresResponse?.(msg);
      return;
    }
    if (m?.type === 'duel.taunt') {
      const payload = (m.payload ?? {}) as Record<string, unknown>;
      const tauntId =
        typeof payload.tauntId === 'string' ? payload.tauntId : '';
      if (tauntId) this.onTauntReceived?.(tauntId);
      return;
    }
    if (this.peerV1Client) {
      this.peerV1Client.handleMessage(msg);
    }
  }

  /** Called when a scores.response arrives from the server-peer. */
  public onScoresResponse?: (msg: unknown) => void;

  /** Send a control channel message (peer-v1). */
  public sendControl(msg: unknown): void {
    if (this.trystero) {
      this.trystero.sendControl(msg);
    }
  }

  /** Send a taunt emoji to the server-peer. */
  public sendTaunt(emoji: string): void {
    if (!this.isPeerV1Game) return;
    this.sendControl({
      type: 'duel.taunt',
      protocolVersion: 'peer-v1',
      messageId: `v1_taunt_${crypto.randomUUID()}`,
      sentAtMs: Date.now(),
      payload: {
        duelId: '',
        slot: 1,
        tauntId: emoji,
      },
    });
  }

  /**
   * Initialize the peer-v1 client for a server-peer duel.
   * Called when joining a duel advertised by a server-peer.
   */
  public initPeerV1Join(
    duelId: string,
    shipType: string,
    requestedSlot: number = 1,
    inviteCode?: string,
  ): void {
    this.isPeerV1Game = true;

    this.peerV1Client = new PeerV1Client({
      sendControl: (msg: unknown) => this.sendControl(msg),
      onJoinAccepted: (result) => {
        this.onStatusUpdate?.('JOINED DUEL');
        this.handshakeComplete = true;
        if (result.seed) {
          // The seed/ruleset will be used by main.ts to create the game state
        }
        this.onPeerV1JoinAccepted?.(result);
      },
      onJoinRejected: (reason, message) => {
        this.onHandshakeFailed?.(message || `Join rejected: ${reason}`);
        this.onPeerV1JoinRejected?.(reason, message);
      },
      onJoinQueued: (info) => {
        this.onStatusUpdate?.(`QUEUED: ${info.message}`);
        this.onPeerV1JoinQueued?.(info);
      },
      onDuelInvite: (duelId, message) => {
        this.onStatusUpdate?.(message ?? 'Slot available!');
        this.onPeerV1DuelInvite?.(duelId, message);
      },
      onPeerHello: (_hello) => {
        // Server-peer identified; if we haven't sent join request yet, do it now
        this.onStatusUpdate?.('SERVER ARENA DETECTED');
      },
    });

    // Send join request when Trystero connection is established.
    // Important: must wait for WebRTC DataChannel to be open, otherwise
    // the message is silently dropped (no active peers).
    const sendJoin = () => {
      // Brief delay to ensure DataChannel is fully open
      setTimeout(() => {
        this.peerV1Client!.sendJoinRequest(
          duelId,
          this.localPlayerId,
          this.localCallSign,
          requestedSlot,
          shipType,
          ['taunts', 'feedback'],
          inviteCode,
        );
      }, 2000); // 2s delay for DataChannel readiness
    };

    // If already connected, send immediately. Otherwise wait for onTrysteroConnected.
    if (this.trystero?.lockedPeerId) {
      sendJoin();
    } else {
      this.onTrysteroConnected = sendJoin;
    }
  }

  private sendHandshake() {
    if (this.mode === 'manual' && !this.expectedManualSession) {
      this.rejectManualSession('Missing agreed match ruleset');
      return;
    }
    const payload: HandshakeMessage = {
      type: 'handshake',
      version: this.appVersion,
      role: this.role,
      callSign: this.localCallSign,
      session: this.mode === 'manual' ? this.expectedManualSession ?? undefined : undefined,
    };
    this.sendRaw(payload);
  }

  private handleMessage(msg: NetworkMessage) {
    if (!msg || typeof msg !== 'object') return;
    this.lastHeartbeat = Date.now();

    if (msg.type === 'handshake') {
      if (msg.version !== this.appVersion) {
        this.versionMismatch = true;
        this.onHandshakeFailed?.(
          `Version mismatch: Local ${this.appVersion}, Remote ${msg.version}`,
        );
        return;
      }
      if (this.mode === 'manual') {
        // A transport role is untrusted wire data. Accept ONLY the exact
        // complementary host/guest role, not any string other than our own.
        const expectedRole: NetworkRole = this.role === 'host' ? 'guest' : 'host';
        if (
          !this.expectedManualSession ||
          (this.role !== 'host' && this.role !== 'guest') ||
          msg.role !== expectedRole
        ) {
          this.rejectManualSession('Invalid peer role or missing match ruleset');
          return;
        }
        const agreement = agreeFlightSession(this.expectedManualSession, msg.session);
        if (!agreement.ok) {
          this.rejectManualSession(`Match ruleset rejected: ${agreement.reason}`);
          return;
        }
      }

      if (msg.callSign) {
        this.remoteCallSign = String(msg.callSign).substring(0, 20);
      }

      // Manual guest cannot start from a host hello: it must receive a host
      // ACK after the host has verified the guest's exact descriptor.
      if (this.mode === 'manual' && this.role === 'guest') return;
      // ACK every matching guest retry, even if the host was already ready;
      // its previous ACK may have been lost on the unreliable DataChannel.
      if (this.mode === 'manual' && this.role === 'host') {
        this.sendRaw({
          type: 'handshake_ack',
          callSign: this.localCallSign,
          session: this.expectedManualSession ?? undefined,
        });
      }
      if (!this.handshakeComplete) {
        if (this.mode !== 'manual' && this.role === 'host') {
          this.sendRaw({ type: 'handshake_ack', callSign: this.localCallSign });
        }
        this.handshakeComplete = true;
        this.onStatusUpdate?.('SYNCING MATCH RULES');
        this.onHandshakeComplete?.();
      }
    } else if (msg.type === 'handshake_ack') {
      if (this.mode === 'manual') {
        if (this.role !== 'guest' || !this.expectedManualSession) {
          this.rejectManualSession('Unexpected match acknowledgement');
          return;
        }
        const agreement = agreeFlightSession(this.expectedManualSession, msg.session);
        if (!agreement.ok) {
          this.rejectManualSession(`Match acknowledgement rejected: ${agreement.reason}`);
          return;
        }
      }
      if (msg.callSign) {
        this.remoteCallSign = String(msg.callSign).substring(0, 20);
      }
      if (!this.handshakeComplete) {
        if (this.mode === 'manual') this.stopManualHandshakeRetries();
        this.handshakeComplete = true;
        this.onStatusUpdate?.('SYNCING MATCH RULES');
        this.onHandshakeComplete?.();
      }
    } else if (msg.type === 'input' && this.role === 'host') {
      if (!this.handshakeComplete || !Number.isSafeInteger(msg.seq) || msg.seq < 0) return;
      const seq = msg.seq;
      if (seq <= this.lastProcessedInputSeq) return; // Drop duplicates and replays
      this.lastProcessedInputSeq = seq;
      // Keep memory bounded even if a peer floods valid monotonic inputs faster
      // than the 60 Hz simulation consumes them. Retain only recent commands.
      if (this.remoteInputBuffer.length >= 8) {
        this.remoteInputBuffer.splice(0, this.remoteInputBuffer.length - 7);
      }
      this.remoteInputBuffer.push(sanitizeInput(msg.input));
    } else if (msg.type === 'state' && this.role === 'guest') {
      if (!this.handshakeComplete || !Number.isSafeInteger(msg.seq) || msg.seq < 0) return;
      if (this.mode === 'manual') {
        const expected = this.expectedManualSession;
        if (
          !expected ||
          !msg.state ||
          msg.state.seed !== expected.seed ||
          msg.state.settings?.flightMode !== expected.flightMode
        ) {
          this.rejectManualSession('State does not match negotiated match ruleset');
          return;
        }
      }
      const seq = msg.seq;
      if (seq <= this.lastProcessedStateTick) return; // Drop duplicates and replays

      // Fail closed on malformed state shape or mismatched tick before the UI
      // can dereference entities or use a forged sequence number.
      if (
        !msg.state ||
        !Array.isArray(msg.state.entities) ||
        !Number.isSafeInteger(msg.state.tick) ||
        msg.state.tick !== seq
      ) return;
      if (msg.state.entities.length > MAX_STATE_ENTITIES) {
        console.warn(
          'NetworkManager: Received abnormally large state, dropping.',
          msg.state.entities.length,
        );
        return;
      }

      this.lastProcessedStateTick = seq;
      this.lastReceivedState = msg.state;
      if (this.onStateReceived) {
        this.onStateReceived(msg.state);
      }
    }
  }

  private sendRaw(payload: NetworkMessage) {
    if (this.mode === 'manual' && this.webrtc) {
      this.webrtc.sendMessage(payload);
    } else if (this.mode === 'trystero' && this.trystero) {
      // Trystero needs to use specific actions, but for simplicity we'll repurpose sendInput/sendState
      // Actually, let's just use sendInput/sendState as a carrier for now or add a raw action.
      // Re-reading trystero.ts, it has 'state' and 'input' actions.
      if (this.role === 'host') this.trystero.sendState(payload);
      else this.trystero.sendInput(payload);
    }
  }

  // Host sends state to guest
  public sendState(state: GameState) {
    if (this.role === 'host' && this.handshakeComplete) {
      if (
        this.mode === 'manual' &&
        (!this.expectedManualSession ||
          state.seed !== this.expectedManualSession.seed ||
          state.settings?.flightMode !== this.expectedManualSession.flightMode)
      ) {
        this.rejectManualSession('Host state diverged from negotiated match ruleset');
        return;
      }
      const payload: StateMessage = { type: 'state', state, seq: state.tick };
      this.sendRaw(payload);
    }
  }

  // Guest sends input to host
  public sendInput(input: PlayerInput) {
    if (this.role === 'guest' && this.handshakeComplete) {
      this.currentInputSeq++;
      const payload: InputMessage = {
        type: 'input',
        input,
        seq: this.currentInputSeq,
      };
      this.sendRaw(payload);
    }
  }

  public close() {
    this.stopManualHandshakeRetries();
    if (this.webrtc) {
      this.webrtc.close();
      this.webrtc = null;
    }
    if (this.trystero) {
      this.trystero.close();
      this.trystero = null;
    }
    this.role = 'local';
    this.lastReceivedState = null;
    this.lastProcessedStateTick = -1;
    this.lastProcessedInputSeq = -1;
    this.currentInputSeq = 0;
    this.remoteInputBuffer = [];
    // No previous-match thrust/weapon input may survive into another duel.
    this.lastInput = {
      thrust: false,
      left: false,
      right: false,
      fire: false,
      fireSecondary: false,
      shield: false,
    };
    this.handshakeComplete = false;
    this.expectedManualSession = null;
    this.isPeerV1Game = false;
    this.peerV1Client = null;
  }
}
