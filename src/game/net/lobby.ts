import { joinRoom as joinNostr } from 'trystero/nostr';
import { parseRemoteDuel, type RemoteDuel } from '../../network/remoteDuelHost';

// DiscoveredGame is now an alias for RemoteDuel — no separate type needed.
// The LobbyManager uses the shared network-layer type directly.
export type { RemoteDuel as DiscoveredGame } from '../../network/remoteDuelHost';

export interface PresenceMessage {
  roomId: string;
  hostName: string;
  strategy: 'nostr' | 'torrent';
  shipClass: string;
}

export interface TrysteroRoom {
  makeAction: (
    name: string,
  ) => [
    (data: unknown, peerId?: string) => void,
    (callback: (data: unknown, peerId: string) => void) => void,
    unknown,
  ];
  onPeerJoin: (callback: (peerId: string) => void) => void;
  onPeerLeave: (callback: (peerId: string) => void) => void;
  leave: () => void;
}

interface LobbyManagerOptions {
  enabled?: boolean;
  /** Custom Nostr relay URLs (for self-hosted relay). */
  relayUrls?: string[];
  /** Optional TURN server URLs for NAT traversal. */
  turnUrls?: string[];
  /** Optional TURN credential username. */
  turnUsername?: string;
  /** Optional TURN credential password. */
  turnCredential?: string;
}

export class LobbyManager {
  private rooms: TrysteroRoom[] = [];
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private discoveredGames: Map<string, RemoteDuel> = new Map();
  private onGamesUpdated?: (games: RemoteDuel[]) => void;

  constructor(
    onGamesUpdated: (games: RemoteDuel[]) => void,
    options: LobbyManagerOptions = {},
  ) {
    this.onGamesUpdated = onGamesUpdated;
    if (options.enabled === false || typeof RTCPeerConnection === 'undefined') {
      this.onGamesUpdated([]);
      return;
    }

    const lobbyName = 'public-lobby-v1';

    // Build TURN config (Open Relay free TURN as fallback).
    const turnUrls = options.turnUrls || [
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ];
    const turnUsername = options.turnUsername || 'openrelayproject';
    const turnCredential = options.turnCredential || 'openrelayproject';
    const turnConfig = turnUrls.map((url) => ({
      urls: url,
      username: turnUsername,
      credential: turnCredential,
    }));

    try {
      if (options.relayUrls && options.relayUrls.length > 0) {
        this.rooms.push(
          joinNostr(
            {
              appId: 'open-space-duel-lobby',
              relayUrls: options.relayUrls,
              turnConfig,
            },
            lobbyName,
          ) as unknown as TrysteroRoom,
        );
      } else {
        this.rooms.push(
          joinNostr(
            { appId: 'open-space-duel-lobby', turnConfig },
            lobbyName,
          ) as unknown as TrysteroRoom,
        );
      }
    } catch (e) {
      console.error('[LOBBY] Failed to join Nostr lobby', e);
    }

    this.rooms.forEach((room) => {
      room.onPeerJoin((peerId: string) => {
        console.warn('[LOBBY] Peer joined lobby:', peerId);
      });

      room.onPeerLeave((peerId: string) => {
        console.warn('[LOBBY] Peer left lobby:', peerId);
      });

      const [, getPresence] = room.makeAction('presence');

      getPresence(((data: PresenceMessage, peerId: string) => {
        console.warn('[LOBBY] Received presence from:', peerId, data);
        this.handlePresence(data);
      }) as (data: unknown, peerId: string) => void);
    });

    // Cleanup stale games every few seconds
    this.cleanupInterval = setInterval(() => this.cleanupStaleGames(), 5000);
  }

  public startHosting(
    roomId: string,
    strategy: 'nostr' | 'torrent',
    shipClass: string,
    hostName: string,
  ) {
    this.stopHosting();

    const broadcast = () => {
      const msg: PresenceMessage = {
        roomId,
        hostName,
        strategy,
        shipClass,
      };

      this.rooms.forEach((room) => {
        try {
          const [sendPresence] = room.makeAction('presence');
          sendPresence(msg);
        } catch {
          // Ignore failed broadcasts on specific rooms
        }
      });
    };

    broadcast();
    this.broadcastInterval = setInterval(broadcast, 4000); // Heartbeat every 4s
  }

  public stopHosting() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  public close() {
    this.stopHosting();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rooms.forEach((room) => {
      try {
        room.leave();
      } catch {
        /* ignore */
      }
    });
    this.rooms = [];
  }

  private handlePresence(data: PresenceMessage) {
    // Parse through the shared network layer (RemoteDuel)
    const duel = parseRemoteDuel(data as unknown as Record<string, unknown>);
    if (!duel) return;

    // Basic Security: Validate payload structure
    if (!data || !data.roomId || !data.hostName || !data.strategy) return;

    // Update lastSeen timestamp and store directly
    duel.lastSeen = Date.now();

    // Deduplicate by duelId — latest presence wins
    this.discoveredGames.set(duel.duelId, duel);

    this.onGamesUpdated?.(Array.from(this.discoveredGames.values()));
  }

  private cleanupStaleGames() {
    const now = Date.now();
    let changed = false;
    for (const [id, game] of this.discoveredGames.entries()) {
      if (now - game.lastSeen > 12000) {
        // 12s timeout (3 missed heartbeats)
        this.discoveredGames.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.onGamesUpdated?.(Array.from(this.discoveredGames.values()));
    }
  }
}
