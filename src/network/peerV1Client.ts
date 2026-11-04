/**
 * PeerV1Client — handles the peer-v1 join protocol for server-hosted duels.
 *
 * When a guest connects to a server-peer duel:
 *   1. Send JoinRequest on the control channel
 *   2. Wait for JoinAccepted (with seed/ruleset) or JoinRejected
 *   3. On JoinAccepted, hand off to the normal input/state tick loop
 *
 * When a browser hosts via P2P, this client is not used — the classic
 * handshake flow continues to work.
 */

import type {
  JoinRequestMessage,
  JoinAcceptedMessage,
  JoinRejectedMessage,
  PeerHelloMessage,
  DuelAdvertisementMessage,
} from '../../packages/osd-protocol/src/messages';

export interface PeerV1JoinResult {
  duelId: string;
  assignedSlot: number;
  seed: number;
  ruleset: string;
  simVersion: string;
  startTick: number;
}

/** Info about being queued for a duel (all slots full). */
export interface QueueInfo {
  spectateRoomId: string;
  queuePosition: number;
  message: string;
}

/** Callback types for queue/invite messages. */
export interface PeerV1Callbacks {
  /** Called when a JoinAccepted message is received. */
  onJoinAccepted: (result: PeerV1JoinResult) => void;
  /** Called when a JoinRejected message is received. */
  onJoinRejected: (reason: string, message?: string) => void;
  /** Called when queued (all slots full). */
  onJoinQueued?: (info: QueueInfo) => void;
  /** Called when invited to a duel after waiting in queue. */
  onDuelInvite?: (duelId: string, message?: string) => void;
  /** Called when a PeerHello is received (can be used to detect server-peer). */
  onPeerHello?: (hello: PeerHelloMessage) => void;
  /** Called when a DuelAdvertisement is received in the duel room. */
  onDuelAdvertisement?: (ad: DuelAdvertisementMessage) => void;
  /** Send function — provided by the transport layer. */
  sendControl: (msg: unknown) => void;
}

export class PeerV1Client {
  private callbacks: PeerV1Callbacks;

  constructor(callbacks: PeerV1Callbacks) {
    this.callbacks = callbacks;
  }

  /** Send a JoinRequest to the server-peer. */
  public sendJoinRequest(
    duelId: string,
    peerId: string,
    displayName: string,
    requestedSlot: number,
    shipType: string,
    capabilities: string[] = [],
    inviteCode?: string,
  ): void {
    const msg: JoinRequestMessage = {
      type: 'duel.join.request',
      protocolVersion: 'peer-v1',
      messageId: generateMessageId(),
      sentAtMs: Date.now(),
      payload: {
        duelId,
        peerId,
        displayName,
        requestedSlot,
        shipType,
        capabilities,
        inviteCode,
      },
    };
    this.callbacks.sendControl(msg);
  }

  /** Handle an incoming message on the control channel. */
  public handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;

    switch (m.type) {
      case 'duel.join.accepted':
        this.handleJoinAccepted(m as unknown as JoinAcceptedMessage);
        break;
      case 'duel.join.rejected':
        this.handleJoinRejected(m as unknown as JoinRejectedMessage);
        break;
      case 'duel.join.queued':
        this.handleJoinQueued(m as Record<string, unknown>);
        break;
      case 'duel.join.invite':
        this.handleDuelInvite(m as Record<string, unknown>);
        break;
      case 'peer.hello':
        this.callbacks.onPeerHello?.(m as unknown as PeerHelloMessage);
        break;
      case 'duel.advertise':
        this.callbacks.onDuelAdvertisement?.(
          m as unknown as DuelAdvertisementMessage,
        );
        break;
      default:
        // Unknown message type on control channel — ignore
        break;
    }
  }

  // ─── Internal handlers ────────────────────────────────────────────────

  private handleJoinAccepted(msg: JoinAcceptedMessage): void {
    const { payload } = msg;
    if (!payload?.duelId) return;

    this.callbacks.onJoinAccepted({
      duelId: payload.duelId,
      assignedSlot: payload.assignedSlot,
      seed: payload.seed,
      ruleset: payload.ruleset,
      simVersion: payload.simVersion,
      startTick: payload.startTick,
    });
  }

  private handleJoinRejected(msg: JoinRejectedMessage): void {
    const { payload } = msg;
    this.callbacks.onJoinRejected(
      payload?.reason ?? 'internal_error',
      payload?.message,
    );
  }

  private handleJoinQueued(msg: Record<string, unknown>): void {
    if (!this.callbacks.onJoinQueued) return;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    this.callbacks.onJoinQueued({
      spectateRoomId: (payload.spectateRoomId as string) ?? '',
      queuePosition: (payload.queuePosition as number) ?? 0,
      message: (payload.message as string) ?? '',
    });
  }

  private handleDuelInvite(msg: Record<string, unknown>): void {
    if (!this.callbacks.onDuelInvite) return;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    this.callbacks.onDuelInvite(
      (payload.duelId as string) ?? '',
      (payload.message as string) ?? '',
    );
  }
}

function generateMessageId(): string {
  return 'v1_' + crypto.randomUUID();
}
