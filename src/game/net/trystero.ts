import { joinRoom as joinNostr } from 'trystero/nostr';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { NetworkMessage } from './sync';
import { TrysteroRoom } from './lobby';

export interface TrysteroConfig {
  roomId: string;
  strategy: 'nostr' | 'torrent';
  /** Optional custom Nostr relay URLs (for self-hosted relay). */
  relayUrls?: string[];
  /** Optional TURN server config for NAT traversal. */
  turnUrls?: string[];
  /** Optional TURN long-term credential username. */
  turnUsername?: string;
  /** Optional TURN long-term credential password. */
  turnCredential?: string;
}

export class TrysteroConnection {
  public room: TrysteroRoom | null = null;
  private sendStateAction: ((data: NetworkMessage) => void) | null = null;
  private sendInputAction: ((data: NetworkMessage) => void) | null = null;
  private sendControlAction: ((data: unknown) => void) | null = null;
  public lockedPeerId: string | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activePeers = new Set<string>();

  public onConnectionStateChange?: (state: string) => void;
  public onStateReceived?: (state: NetworkMessage, peerId: string) => void;
  public onInputReceived?: (input: NetworkMessage, peerId: string) => void;
  public onControlReceived?: (msg: unknown, peerId: string) => void;

  constructor(config: TrysteroConfig) {
    // Build TURN config — prefer provided credentials, fall back to
    // Open Relay free TURN (emergency fallback only).
    const turnUrls = config.turnUrls?.length
      ? config.turnUrls
      : [
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ];
    const turnUsername = config.turnUsername || 'openrelayproject';
    const turnCredential = config.turnCredential || 'openrelayproject';
    const turnConfig = turnUrls.map((url) => ({
      urls: url,
      username: turnUsername,
      credential: turnCredential,
    }));

    const baseConfig: any = { appId: 'open-space-duel', turnConfig };

    if (config.strategy === 'nostr') {
      if (config.relayUrls && config.relayUrls.length > 0) {
        this.room = joinNostr(
          { ...baseConfig, relayUrls: config.relayUrls },
          config.roomId,
        ) as unknown as TrysteroRoom;
      } else {
        this.room = joinNostr(
          baseConfig,
          config.roomId,
        ) as unknown as TrysteroRoom;
      }
    } else {
      this.room = joinTorrent(
        baseConfig,
        config.roomId,
      ) as unknown as TrysteroRoom;
    }

    if (!this.room) return;

    this.room.onPeerJoin((peerId: string) => {
      console.warn('Trystero Peer Joined:', peerId);
      this.activePeers.add(peerId);
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (!this.lockedPeerId || !this.activePeers.has(this.lockedPeerId)) {
        this.lockedPeerId = peerId;
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange('connected');
        }
      }
    });

    this.room.onPeerLeave((peerId: string) => {
      console.warn('Trystero Peer Left:', peerId);
      this.activePeers.delete(peerId);
      if (this.lockedPeerId === peerId) {
        const replacement = this.pickReplacementPeer();
        if (replacement) {
          this.lockedPeerId = replacement;
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          return;
        }

        if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.lockedPeerId === peerId && !this.pickReplacementPeer()) {
            this.lockedPeerId = null;
            if (this.onConnectionStateChange) {
              this.onConnectionStateChange('disconnected');
            }
          }
          this.disconnectTimer = null;
        }, 5000);
      }
    });

    // Register actions
    const [sendState, getState] = this.room.makeAction('state');
    const [sendInput, getInput] = this.room.makeAction('input');
    const [sendControl, getControl] = this.room.makeAction('control');

    this.sendStateAction = sendState;
    this.sendInputAction = sendInput;
    this.sendControlAction = sendControl as (data: unknown) => void;

    getState(((data: NetworkMessage, peerId: string) => {
      this.activePeers.add(peerId);
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (!this.lockedPeerId || this.lockedPeerId !== peerId) {
        this.lockedPeerId = peerId;
      }
      if (this.onStateReceived) this.onStateReceived(data, peerId);
    }) as (data: unknown, peerId: string) => void);

    getInput(((data: NetworkMessage, peerId: string) => {
      this.activePeers.add(peerId);
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (!this.lockedPeerId || this.lockedPeerId !== peerId) {
        this.lockedPeerId = peerId;
      }
      if (this.onInputReceived) this.onInputReceived(data, peerId);
    }) as (data: unknown, peerId: string) => void);

    getControl(((data: unknown, peerId: string) => {
      this.activePeers.add(peerId);
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (!this.lockedPeerId || this.lockedPeerId !== peerId) {
        this.lockedPeerId = peerId;
      }
      if (this.onControlReceived) this.onControlReceived(data, peerId);
    }) as (data: unknown, peerId: string) => void);
  }

  private pickReplacementPeer(): string | null {
    for (const peerId of this.activePeers) {
      if (peerId !== this.lockedPeerId) return peerId;
    }
    return null;
  }

  public sendState(state: NetworkMessage) {
    if (this.sendStateAction) {
      this.sendStateAction(state);
    }
  }

  public sendInput(input: NetworkMessage) {
    if (this.sendInputAction) {
      this.sendInputAction(input);
    }
  }

  public sendControl(msg: unknown) {
    if (this.sendControlAction) {
      this.sendControlAction(msg as any);
    }
  }

  public close() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.sendStateAction = null;
    this.sendInputAction = null;
    this.sendControlAction = null;
    this.activePeers.clear();
  }
}
