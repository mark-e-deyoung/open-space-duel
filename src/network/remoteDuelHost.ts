/**
 * Remote Duel Host — typed model for duels discovered in the lobby.
 *
 * Distinguishes between P2P-hosted duels (browser peers) and
 * server-peer-hosted duels (Node.js server-peer) so the UI can
 * render them differently.
 */

/** The source of a discovered duel. */
export type DuelSource = 'p2p' | 'server-peer';

/** Player/bot occupying a slot. */
export interface DuelSlot {
  slot: number;
  status: 'open' | 'occupied' | 'reserved';
  playerKind: 'human' | 'bot';
  displayName?: string;
  shipType?: string;
}

/** TURN credentials advertised by a server-peer. */
export interface RemoteTurnInfo {
  urls: string[];
  username: string;
  credential: string;
}

/** A duel discovered in the public lobby directory. */
export interface RemoteDuel {
  /** Unique room identifier (maps to Trystero room or WebRTC room). */
  duelId: string;
  /** Human-readable title. */
  title: string;
  /** Name of the host (call sign or server name). */
  hostName: string;
  /** Where this duel originated. */
  source: DuelSource;
  /** Strategy for connecting (nostr, torrent). */
  strategy: 'nostr' | 'torrent';
  /** Current state: waiting for players, running, or closed. */
  state: 'waiting' | 'running' | 'closed';
  /** Ship class of the host. */
  shipClass: string;
  /** Slots in this duel (bot occupants visible to players). */
  slots?: DuelSlot[];
  /** Capabilities advertised by the host. */
  capabilities?: string[];
  /** TURN relay credentials for NAT traversal (server-peer only). */
  turnInfo?: RemoteTurnInfo;
  /** Whether the duel requires an invite code to join. */
  requiresInviteCode?: boolean;
  /** Server identity fingerprint for trust verification (hash of host+strategy+ship). */
  fingerprint?: string;
  /** When this duel was last seen (ms timestamp). */
  lastSeen: number;
}

/**
 * Classify a raw presence message from the lobby.
 *
 * Server-peer presence messages follow the PresenceMessage format
 * and may include additional fields like `duelId`, `source`, `slots`, etc.
 * Plain P2P presence uses the basic `PresenceMessage` from LobbyManager.
 */
export function classifyDuelSource(data: Record<string, unknown>): DuelSource {
  // Server-peer DirectoryPeer broadcasts with additional metadata
  if (data.source === 'server-peer') return 'server-peer';
  // Future: check for capabilities or slot data
  if (data.slots !== undefined || data.state !== undefined)
    return 'server-peer';
  return 'p2p';
}

/**
 * Parse a raw presence payload into a typed RemoteDuel.
 */
export function parseRemoteDuel(
  data: Record<string, unknown>,
): RemoteDuel | null {
  const roomId = sanitizeId(data.roomId);
  if (!roomId) return null;

  const hostName = sanitizeName(data.hostName);
  if (!hostName) return null;

  const strategy = sanitizeStrategy(data.strategy);
  if (!strategy) return null;

  const source = classifyDuelSource(data);
  const title = sanitizeTitle(data.title) || hostName;
  const shipClass = sanitizeShipClass(data.shipClass) || 'standard';
  const state = sanitizeState(data.state) || 'waiting';
  const slots = parseSlots(data.slots);
  const capabilities = parseCapabilities(data.capabilities);
  const turnInfo = parseTurnInfo(data.turnInfo);
  const requiresInviteCode = !!data.requiresInviteCode;
  const fingerprint =
    typeof data.fingerprint === 'string' ? data.fingerprint : undefined;

  return {
    duelId: roomId,
    title,
    hostName,
    source,
    strategy,
    state,
    shipClass,
    slots,
    capabilities,
    turnInfo,
    requiresInviteCode,
    fingerprint,
    lastSeen: Date.now(),
  };
}

// ─── Sanitizers ──────────────────────────────────────────────────────────

function sanitizeId(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[^\w-]/g, '').substring(0, 50);
}

function sanitizeName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[<>]/g, '').substring(0, 20);
}

function sanitizeTitle(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[<>]/g, '').substring(0, 40);
}

function sanitizeStrategy(v: unknown): 'nostr' | 'torrent' | null {
  if (v === 'nostr' || v === 'torrent') return v;
  return null;
}

function sanitizeShipClass(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[^\w-]/g, '').substring(0, 20);
}

function sanitizeState(v: unknown): RemoteDuel['state'] | null {
  if (v === 'waiting' || v === 'running' || v === 'closed') return v;
  return null;
}

function parseSlots(v: unknown): DuelSlot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const result: DuelSlot[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const slot = s as Record<string, unknown>;
    const slotNum = typeof slot.slot === 'number' ? slot.slot : -1;
    if (slotNum < 0) continue;
    result.push({
      slot: slotNum,
      status: sanitizeSlotStatus(slot.status),
      playerKind: sanitizePlayerKind(slot.playerKind),
      displayName: sanitizeName(slot.displayName),
      shipType: sanitizeShipClass(slot.shipType),
    });
  }
  return result.length > 0 ? result : undefined;
}

function sanitizeSlotStatus(v: unknown): 'open' | 'occupied' | 'reserved' {
  if (v === 'open' || v === 'occupied' || v === 'reserved') return v;
  return 'open';
}

function sanitizePlayerKind(v: unknown): 'human' | 'bot' {
  if (v === 'human' || v === 'bot') return v;
  return 'human';
}

function parseCapabilities(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const caps = v.filter((c): c is string => typeof c === 'string');
  return caps.length > 0 ? caps : undefined;
}

function parseTurnInfo(v: unknown): RemoteTurnInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as Record<string, unknown>;
  if (
    !Array.isArray(t.urls) ||
    typeof t.username !== 'string' ||
    typeof t.credential !== 'string'
  )
    return undefined;
  const urls = t.urls.filter((u): u is string => typeof u === 'string');
  if (!urls.length) return undefined;
  return { urls, username: t.username, credential: t.credential };
}
