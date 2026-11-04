/**
 * Open Space Duel Peer Protocol v1 — Message Types
 *
 * Tier 1: SPA-compatible (existing wire format from src/game/net/sync.ts)
 * Tier 2: Directory & discovery (new)
 * Tier 3: Duel lifecycle (new)
 * Tier 4: Extended features (new)
 */

// ─── Tier 1: SPA-compatible (existing wire format) ────────────────────────

/** Maps to the existing `handshake` message in src/game/net/sync.ts */
export interface HandshakeMessage {
  type: 'handshake';
  version: string;
  role: 'host' | 'guest' | 'local';
  callSign: string;
}

/** Maps to the existing `handshake_ack` message */
export interface HandshakeAckMessage {
  type: 'handshake_ack';
  callSign: string;
}

/** Player input for a single tick. Maps to the existing `input` message payload. */
export interface InputFrame {
  type: 'input';
  seq: number;
  input: PlayerInputPayload;
}

export interface PlayerInputPayload {
  thrust: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  fireSecondary: boolean;
  shield: boolean;
  targetRotation?: number | null;
  customization?: ShipCustomizationPayload;
}

export interface ShipCustomizationPayload {
  statFocus: number;
  speedBonus?: number;
  shieldBonus?: number;
}

/** Maps to the existing `state` message */
export interface StateFrame {
  type: 'state';
  seq: number;
  state: unknown; // GameState — typed as unknown to avoid circular dependency
}

// ─── Tier 2: Directory & discovery ────────────────────────────────────────

export type PeerKind =
  | 'browser'
  | 'server-peer'
  | 'replay-host'
  | 'broadcast-host';

export interface PeerHelloPayload {
  peerId: string;
  displayName: string;
  peerKind: PeerKind;
  clientVersion: string;
  capabilities: string[];
}

export interface PeerHelloMessage {
  type: 'peer.hello';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: PeerHelloPayload;
}

export type DuelState = 'waiting' | 'running' | 'closed';

export interface DuelSlot {
  slot: number;
  status: 'open' | 'occupied' | 'reserved';
  playerKind: 'human' | 'bot';
  displayName?: string;
  shipType?: string;
}

export interface DuelAdvertisementPayload {
  duelId: string;
  title: string;
  visibility: 'public' | 'private';
  host: {
    peerId: string;
    kind: 'server' | 'browser';
    displayName: string;
  };
  state: DuelState;
  mode: 'duel' | 'training' | 'arena';
  ruleset: string;
  simVersion: string;
  seed: number;
  slots: DuelSlot[];
  capabilities: string[];
  connection: {
    kind: 'trystero-room' | 'webrtc-manual';
    roomId: string;
  };
}

export interface DuelAdvertisementMessage {
  type: 'duel.advertise';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: DuelAdvertisementPayload;
}

export interface DuelUnadvertisePayload {
  duelId: string;
}

export interface DuelUnadvertiseMessage {
  type: 'duel.unadvertise';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: DuelUnadvertisePayload;
}

export interface DuelHeartbeatPayload {
  duelId: string;
  state: DuelState;
  activeSlots: number;
  tick: number;
}

export interface DuelHeartbeatMessage {
  type: 'duel.heartbeat';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: DuelHeartbeatPayload;
}

// ─── Tier 3: Duel lifecycle ───────────────────────────────────────────────

export interface JoinRequestPayload {
  duelId: string;
  peerId: string;
  displayName: string;
  requestedSlot: number;
  shipType: string;
  capabilities: string[];
  /** Optional invite code for gated servers. */
  inviteCode?: string;
}

export interface JoinRequestMessage {
  type: 'duel.join.request';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: JoinRequestPayload;
}

export interface JoinAcceptedPayload {
  duelId: string;
  assignedSlot: number;
  seed: number;
  ruleset: string;
  simVersion: string;
  startTick: number;
}

export interface JoinAcceptedMessage {
  type: 'duel.join.accepted';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: JoinAcceptedPayload;
}

export type JoinRejectReason =
  | 'slot_occupied'
  | 'duel_full'
  | 'duel_closed'
  | 'version_mismatch'
  | 'banned'
  | 'internal_error';

export interface JoinRejectedPayload {
  duelId: string;
  reason: JoinRejectReason;
  message?: string;
}

export interface JoinRejectedMessage {
  type: 'duel.join.rejected';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: JoinRejectedPayload;
}

export type LeaveReason =
  | 'user_quit'
  | 'disconnected'
  | 'rage_quit'
  | 'match_end';

export interface DuelLeavePayload {
  duelId: string;
  reason: LeaveReason;
}

export interface DuelLeaveMessage {
  type: 'duel.leave';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: DuelLeavePayload;
}

export interface PingMessage {
  type: 'peer.ping';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: Record<string, never>;
}

export interface PongPayload {
  echoMessageId: string;
}

export interface PongMessage {
  type: 'peer.pong';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: PongPayload;
}

// ─── Tier 4: Extended ─────────────────────────────────────────────────────

export interface TauntMessagePayload {
  duelId: string;
  slot: number;
  tauntId: string;
  text: string;
}

export interface TauntMessage {
  type: 'duel.taunt';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: TauntMessagePayload;
}

export interface FeedbackEventPayload {
  duelId: string;
  sessionId: string;
  rating: number;
  sentiment: string;
  tags: string[];
}

export interface FeedbackEventMessage {
  type: 'feedback.submit';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: FeedbackEventPayload;
}

export interface ScoreSubmissionPayload {
  duelId: string;
  playerId: string;
  score: number;
  mode: string;
  shipType: string;
  replayHash?: string;
}

export interface ScoreSubmissionMessage {
  type: 'score.submit';
  protocolVersion: 'peer-v1';
  messageId: string;
  sentAtMs: number;
  payload: ScoreSubmissionPayload;
}

// ─── Union types ──────────────────────────────────────────────────────────

/** All SPA-compatible Tier 1 messages */
export type SpaMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | InputFrame
  | StateFrame;

/** All new peer-v1 envelope-bearing messages (Tiers 2-4) */
export type PeerV1Message =
  | PeerHelloMessage
  | DuelAdvertisementMessage
  | DuelUnadvertiseMessage
  | DuelHeartbeatMessage
  | JoinRequestMessage
  | JoinAcceptedMessage
  | JoinRejectedMessage
  | DuelLeaveMessage
  | PingMessage
  | PongMessage
  | TauntMessage
  | FeedbackEventMessage
  | ScoreSubmissionMessage;

/** Every message type in the protocol */
export type ProtocolMessage = SpaMessage | PeerV1Message;

/** Message type string literals */
export type SpaMessageType = SpaMessage['type'];
export type PeerV1MessageType = PeerV1Message['type'];
export type ProtocolMessageType = SpaMessageType | PeerV1MessageType;

/** Protocol version constant */
export const PROTOCOL_VERSION = 'peer-v1' as const;

/** All recognized message type strings */
export const MESSAGE_TYPES: ReadonlyArray<string> = [
  // Tier 1
  'handshake',
  'handshake_ack',
  'input',
  'state',
  // Tier 2
  'peer.hello',
  'duel.advertise',
  'duel.unadvertise',
  'duel.heartbeat',
  // Tier 3
  'duel.join.request',
  'duel.join.accepted',
  'duel.join.rejected',
  'duel.leave',
  'peer.ping',
  'peer.pong',
  // Tier 4
  'duel.taunt',
  'feedback.submit',
  'score.submit',
];
