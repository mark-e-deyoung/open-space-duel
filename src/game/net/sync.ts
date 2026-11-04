import { GameState, PlayerInput } from '../engine/state';
import { WebRTCConnection } from './webrtc';
import { TrysteroConnection, TrysteroConfig } from './trystero';
import {
  PeerV1Client,
  type PeerV1JoinResult,
} from '../../network/peerV1Client';
import { MAX_STATE_ENTITIES } from '../engine/worldConfig';

export type NetworkRole = 'local' | 'host' | 'guest';

export interface HandshakeMessage {
  type: 'handshake';
  version: string;
  role: NetworkRole;
  callSign: string;
}

export interface HandshakeAckMessage {
  type: 'handshake_ack';
  callSign: string;
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

export function sanitizeInput(input: unknown): PlayerInput {
  const i = input as Partial<PlayerInput> & {
    customization?: Record<string, unknown>;
  };
  return {
    thrust: !!i?.thrust,
    left: !!i?.left,
    right: !!i?.right,
    fire: !!i?.fire,
    fireSecondary: !!i?.fireSecondary,
    shield: !!i?.shield,
    customization: i?.customization
      ? {
          statFocus: Number(i.customization.statFocus) || 0,
          speedBonus:
            typeof i.customization.speedBonus === 'number'
              ? i.customization.speedBonus
              : undefined,
          shieldBonus:
            typeof i.customization.shieldBonus === 'number'
              ? i.customization.shieldBonus
              : undefined,
        }
      : undefined,
    targetRotation:
      typeof i?.targetRotation === 'number' ? i.targetRotation : undefined,
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
      // Manual trigger for handshake once socket is open
      this.sendHandshake();
    };
    this.webrtc.onConnectionStateChange = (state) => {
      console.debug(`[SYNC] WebRTC Connection State: ${state}`);
      if (state === 'connected') {
        // Fallback for some browsers/environments
        setTimeout(() => {
          if (!this.handshakeComplete) {
            console.debug(
              '[SYNC] Handshake not complete after WebRTC connected, retry sending handshake...',
            );
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
    const payload: HandshakeMessage = {
      type: 'handshake',
      version: this.appVersion,
      role: this.role,
      callSign: this.localCallSign,
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

      if (msg.callSign) {
        this.remoteCallSign = String(msg.callSign).substring(0, 20);
      }

      // If we are guest and receive host handshake, or vice versa
      if (!this.handshakeComplete) {
        this.handshakeComplete = true;
        this.onStatusUpdate?.('SYNCING VERSION');
        // Host sends an ack if they receive a guest handshake
        if (this.role === 'host') {
          this.sendRaw({
            type: 'handshake_ack',
            callSign: this.localCallSign,
          });
        }
        this.onHandshakeComplete?.();
      }
    } else if (msg.type === 'handshake_ack') {
      if (msg.callSign) {
        this.remoteCallSign = String(msg.callSign).substring(0, 20);
      }
      if (!this.handshakeComplete) {
        this.handshakeComplete = true;
        this.onStatusUpdate?.('SYNCING VERSION');
        this.onHandshakeComplete?.();
      }
    } else if (msg.type === 'input' && this.role === 'host') {
      const seq = typeof msg.seq === 'number' ? msg.seq : 0;
      if (seq < this.lastProcessedInputSeq) return; // Drop out of order
      this.lastProcessedInputSeq = seq;
      this.remoteInputBuffer.push(sanitizeInput(msg.input));
    } else if (msg.type === 'state' && this.role === 'guest') {
      if (!this.handshakeComplete) return; // Drop state until handshake done
      const seq = typeof msg.seq === 'number' ? msg.seq : 0;
      if (seq < this.lastProcessedStateTick) return; // Drop out of order

      // Guard: Validate state size / entity count
      if (
        msg.state?.entities &&
        Array.isArray(msg.state.entities) &&
        msg.state.entities.length > MAX_STATE_ENTITIES
      ) {
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
    this.handshakeComplete = false;
    this.isPeerV1Game = false;
    this.peerV1Client = null;
  }
}
