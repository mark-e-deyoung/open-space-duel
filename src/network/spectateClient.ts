/**
 * Spectate Client — joins a spectate room and receives lightweight state.
 *
 * Connects via Trystero to osd-spectate-<duelId> and renders game state
 * from a spectator perspective (no input, no HUD controls).
 */

import type { TrysteroRoom } from '../game/net/lobby';

export interface SpectateShip {
  ownerId: string;
  position: { x: number; y: number };
  rotation: number;
  velocity: { x: number; y: number };
  energy: number;
  isShieldActive: boolean;
  isThrusting: boolean;
  shipClass: string;
  color?: string;
}

export interface SpectateProjectile {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  color?: string;
}

export interface SpectateState {
  tick: number;
  wave: number;
  isGameOver: boolean;
  isPaused: boolean;
  score: Record<string, number>;
  lives: Record<string, number>;
  playerCallSigns: Record<string, string>;
  ships: SpectateShip[];
  projectiles: SpectateProjectile[];
}

export interface SpectateEvent {
  type: 'gameOver';
  scores: Record<string, number>;
  winner: string | null;
}

export type JoinSpectateFn = (
  config: Record<string, unknown>,
  roomName: string,
) => TrysteroRoom;

export class SpectateClient {
  private room: TrysteroRoom | null = null;
  public state: SpectateState | null = null;
  public lastEvent: SpectateEvent | null = null;

  public onStateUpdate?: (state: SpectateState) => void;
  public onGameOver?: (event: SpectateEvent) => void;

  constructor(
    private duelId: string,
    private joinRoom: JoinSpectateFn,
  ) {}

  connect(): void {
    try {
      this.room = this.joinRoom(
        { appId: 'open-space-duel' },
        `osd-spectate-${this.duelId}`,
      ) as TrysteroRoom;

      const [, getSpectate] = this.room.makeAction('spectate');
      getSpectate((data: unknown) => {
        const msg = data as Record<string, unknown>;
        if (msg.type === 'spectate' && msg.state) {
          const st = msg.state as SpectateState;
          this.state = st;
          this.onStateUpdate?.(st);
        } else if (msg.type === 'spectateEvent' && msg.event) {
          const ev = msg.event as SpectateEvent;
          this.lastEvent = ev;
          if (ev.type === 'gameOver') {
            this.onGameOver?.(ev);
          }
        }
      });
    } catch (err) {
      console.error('[Spectate] Failed to join spectate room:', err);
    }
  }

  disconnect(): void {
    if (this.room) {
      try {
        this.room.leave();
      } catch {
        /* best effort */
      }
      this.room = null;
    }
    this.state = null;
    this.lastEvent = null;
  }
}
