/**
 * SPA Telemetry Collector — lightweight, fire-and-forget usage tracking.
 *
 * Design goals:
 *   <2 KB memory overhead
 *   <1 μs per event push (synchronous)
 *   Batch flush at game-over OR every 5 min OR on page unload
 *   Drop on failure — never retry, never queue to localStorage
 *   50 event cap per session, throttle after
 *
 * Events are sent to the existing POST /v1/telemetry endpoint on osd-control.
 * A batch endpoint (POST /v1/telemetry/batch) accepts arrays for efficiency.
 */

export interface TelemetryEvent {
  /** Event type — short snake_case string. */
  et: string;
  /** Duel ID (empty string for pre-game events). */
  did: string;
  /** Player ID (from identity.id). */
  pid: string;
  /** Game length in ticks (0 for non-game events). */
  tks: number;
  /** Unix ms timestamp when event fired. */
  ts: number;
  /** Optional string payload (ship class, mode, error message, etc). */
  v?: string;
  /** Optional numeric payload (score, rating, etc). */
  n?: number;
}

const MAX_EVENTS = 50;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const SEND_TIMEOUT_MS = 3000;

export class TelemetryCollector {
  private buffer: TelemetryEvent[] = [];
  private playerId: string;
  private baseUrl: string;
  private sessionGames = 0;
  private throttled = false;
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(playerId: string, baseUrl: string) {
    this.playerId = playerId;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.startFlushTimer();

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushSync());
      // Also flush when page becomes hidden (tab switch / mobile background)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushSync();
      });
    }
  }

  /** Push an event. Sub-microsecond cost. Returns false if throttled. */
  emit(et: string, did: string, tks: number, v?: string, n?: number): boolean {
    if (this.throttled) return false;

    this.buffer.push({
      et,
      did,
      pid: this.playerId,
      tks,
      ts: Date.now(),
      v,
      n,
    });

    if (this.buffer.length >= MAX_EVENTS) {
      this.throttled = true;
    }

    // Flush if batch threshold reached
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush();
    }

    return true;
  }

  /** Track that a game was completed. */
  incrementSessionGames(): void {
    this.sessionGames++;
  }

  /** Return number of games this session. */
  getSessionGames(): number {
    return this.sessionGames;
  }

  /** Set the player ID (e.g. after regeneration). */
  setPlayerId(id: string): void {
    this.playerId = id;
  }

  /** Flush asynchronously — fire and forget. */
  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.sendBatch(batch);
  }

  /** Synchronous flush using sendBeacon (for beforeunload). */
  private flushSync(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      navigator.sendBeacon(
        `${this.baseUrl}/v1/telemetry/batch`,
        new Blob([JSON.stringify(batch)], { type: 'application/json' }),
      );
    } catch {
      // sendBeacon failed — drop silently
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private startFlushTimer(): void {
    if (this.flushTimerId) return; // Guard against double-init
    this.flushTimerId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Stop the flush timer. Call during cleanup to prevent lingering intervals. */
  public stop(): void {
    if (this.flushTimerId) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }
  }

  private sendBatch(batch: TelemetryEvent[]): void {
    const body = JSON.stringify(batch);
    // Fire-and-forget — no await, no retry
    fetch(`${this.baseUrl}/v1/telemetry/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      keepalive: true,
    }).catch((err) => {
      console.warn('[telemetry] send failed:', err);
    });
  }
}
