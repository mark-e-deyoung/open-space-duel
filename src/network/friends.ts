/**
 * Friends system — discover friends online and invite them to duels.
 *
 * Uses Nostr presence on room "osd-friends-v1" for online detection.
 * Friend list is stored in localStorage for persistence across sessions.
 *
 * Flow:
 *   1. Players exchange friend codes once (out-of-band — QR code or verbal).
 *   2. Add friend → SPA stores in localStorage and watches for their presence.
 *   3. Friend comes online → shows in friends panel with INVITE button.
 *   4. INVITE → sends a duel invite via Nostr presence to the friend's room.
 */

import { joinRoom as joinNostr } from 'trystero/nostr';
import type { TrysteroRoom } from '../game/net/lobby';

const STORAGE_KEY = 'osd-friends';
const FRIENDS_ROOM = 'osd-friends-v1';
const APP_ID = 'open-space-duel-friends';

export interface FriendEntry {
  playerId: string;
  callSign: string;
  addedAt: number;
  lastSeenAt: number | null;
  online: boolean;
}

export type FriendListCallback = (friends: FriendEntry[]) => void;
export type DuelInviteCallback = (friendId: string, friendName: string) => void;

export class FriendsManager {
  private friends: Map<string, FriendEntry> = new Map();
  private room: TrysteroRoom | null = null;
  private onUpdate: FriendListCallback | null = null;
  private onInvite: DuelInviteCallback | null = null;
  private myPlayerId: string;
  private myCallSign: string;
  private presenceInterval: ReturnType<typeof setInterval> | null = null;

  constructor(playerId: string, callSign: string) {
    this.myPlayerId = playerId;
    this.myCallSign = callSign;
    this.load();
  }

  /** Start listening for friends' presence. */
  start(): void {
    if (this.room) return;
    try {
      this.room = joinNostr(
        { appId: APP_ID },
        FRIENDS_ROOM,
      ) as unknown as TrysteroRoom;

      // Listen for friend presence
      const [, getPresence] = this.room.makeAction('presence');
      getPresence(((data: Record<string, unknown>) => {
        this.handlePresence(data);
      }) as (data: unknown, peerId: string) => void);

      // Broadcast own presence
      this.broadcastPresence();
      this.presenceInterval = setInterval(
        () => this.broadcastPresence(),
        15000,
      );
    } catch {
      console.warn('[Friends] Failed to join friends room');
    }
  }

  /** Stop listening. */
  stop(): void {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }
    if (this.room) {
      try {
        this.room.leave();
      } catch {
        /* ignore */
      }
      this.room = null;
    }
    // Mark all friends offline
    let changed = false;
    for (const [, f] of this.friends) {
      if (f.online) {
        f.online = false;
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  // ── Friend list management ───────────────────────────────────────────

  /** Generate a short 6-digit friend code from a player ID. */
  static generateFriendCode(playerId: string): string {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = ((hash << 5) - hash + playerId.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 1000000).toString().padStart(6, '0');
  }

  /** Add a friend by player ID and call sign. */
  addFriend(playerId: string, callSign: string): FriendEntry {
    if (this.friends.has(playerId)) return this.friends.get(playerId)!;
    const entry: FriendEntry = {
      playerId,
      callSign: callSign || 'Unknown Pilot',
      addedAt: Date.now(),
      lastSeenAt: null,
      online: false,
    };
    this.friends.set(playerId, entry);
    this.save();
    this.notify();
    return entry;
  }

  /** Remove a friend. */
  removeFriend(playerId: string): void {
    this.friends.delete(playerId);
    this.save();
    this.notify();
  }

  /** Get all friends sorted by online status then name. */
  getFriends(): FriendEntry[] {
    return [...this.friends.values()].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.callSign.localeCompare(b.callSign);
    });
  }

  /** Get my friend code (player ID) for sharing. */
  getMyFriendCode(): string {
    return this.myPlayerId;
  }

  /** Get my call sign. */
  getMyCallSign(): string {
    return this.myCallSign;
  }

  /** Set callback for friend list changes. */
  set onFriendListUpdate(cb: FriendListCallback) {
    this.onUpdate = cb;
  }

  /** Set callback for incoming duel invites. */
  set onDuelInvite(cb: DuelInviteCallback) {
    this.onInvite = cb;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private handlePresence(data: Record<string, unknown>): void {
    const playerId = typeof data.playerId === 'string' ? data.playerId : '';
    const callSign = typeof data.callSign === 'string' ? data.callSign : '';
    const type = typeof data.type === 'string' ? data.type : '';

    if (!playerId) return;

    // Duel invite
    if (type === 'duel-invite' && this.onInvite) {
      this.onInvite(playerId, callSign);
      return;
    }

    // Online presence
    if (this.friends.has(playerId)) {
      const friend = this.friends.get(playerId)!;
      friend.online = true;
      friend.lastSeenAt = Date.now();
      if (callSign) friend.callSign = callSign;
      this.save();
      this.notify();
    }
  }

  private broadcastPresence(): void {
    if (!this.room) return;
    try {
      const [sendPresence] = this.room.makeAction('presence');
      (sendPresence as (data: unknown) => void)({
        playerId: this.myPlayerId,
        callSign: this.myCallSign,
        type: 'presence',
      });
    } catch {
      /* ignore */
    }
  }

  /** Send a duel invite to a specific friend. */
  sendDuelInvite(_friendId: string, duelId: string, inviteCode?: string): void {
    if (!this.room) return;
    try {
      const [sendPresence] = this.room.makeAction('presence');
      (sendPresence as (data: unknown) => void)({
        playerId: this.myPlayerId,
        callSign: this.myCallSign,
        type: 'duel-invite',
        duelId,
        inviteCode: inviteCode || '',
      });
    } catch {
      /* ignore */
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const list: FriendEntry[] = JSON.parse(raw);
      for (const f of list) {
        f.online = false; // reset on load
        this.friends.set(f.playerId, f);
      }
    } catch {
      /* corrupted storage */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.friends.values()]),
      );
    } catch {
      /* quota exceeded */
    }
  }

  private notify(): void {
    if (this.onUpdate) this.onUpdate(this.getFriends());
  }
}
