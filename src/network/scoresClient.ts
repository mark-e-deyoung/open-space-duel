/**
 * Scores & Leaderboard API client for the Go control service.
 *
 * Supports two paths:
 *   1. Direct HTTP (baseUrl) — used when no peer connection exists (menu mode)
 *   2. Server-peer proxy (peerSend) — used during duels, routes through Trystero
 *
 * Calls silently fail if either path is unreachable — scores are optional.
 */

export interface LeaderboardEntry {
  playerId: string;
  playerName: string;
  score: number;
  matches: number;
  wins: number;
}

export interface RecentMatch {
  duelId: string;
  playerId: string;
  playerName: string;
  score: number;
  mode: string;
  shipType: string;
  botPersonality?: string;
  won: boolean;
  wavesCompleted: number;
  ticks: number;
  createdAt: string;
}

export interface ScoreSubmission {
  duelId: string;
  playerId: string;
  playerName: string;
  score: number;
  mode: string;
  shipType: string;
  botPersonality?: string;
  won: boolean;
  wavesCompleted: number;
  ticks: number;
  replayHash?: string;
}

export interface FeedbackSubmission {
  duelId: string;
  playerId: string;
  rating: number;
  tags: string[];
}

/** TURN credentials returned by osd-control's /v1/turn-credentials endpoint. */
export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
  ttlSeconds: number;
}

export type PeerProxy = {
  /** Send a control message through the peer connection. */
  sendControl: (msg: unknown) => void;
  /** Fallback base URL for direct HTTP when proxy unavailable. */
  baseUrl: string;
};

/**
 * Normalize the score-service base URL while repairing the legacy main.ts
 * same-origin bug that turns `https://host` into `https:/`.
 *
 * Empty remains empty for proxy-only callers. Normal explicit URLs retain the
 * existing behavior of trimming trailing slashes.
 */
export function normalizeScoresBaseUrl(
  baseUrl: string,
  browserOrigin?: string,
): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  // The legacy `https:/` / `http:/` values become `https:` / `http:` after
  // trailing-slash normalization. Recognize that sentinel, not the pre-trim
  // spelling, so recovery actually occurs.
  if (/^https?:$/i.test(normalized) && browserOrigin) {
    return browserOrigin.replace(/\/+$/, '');
  }
  return normalized;
}

export class ScoresClient {
  private baseUrl: string;
  private proxy: PeerProxy | null = null;

  constructor(baseUrl: string) {
    const browserOrigin =
      typeof window !== 'undefined' ? window.location.origin : undefined;
    this.baseUrl = normalizeScoresBaseUrl(baseUrl, browserOrigin);
  }

  /** Enable routing through a peer connection (server-peer proxy). */
  setProxy(proxy: PeerProxy): void {
    this.proxy = proxy;
  }
  /** Disable proxy, use direct HTTP. */
  clearProxy(): void {
    this.proxy = null;
  }

  async leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
    if (this.proxy) {
      return this.proxyFetch<LeaderboardEntry>('leaderboard', { limit });
    }
    return (
      (await this.httpFetch<LeaderboardEntry[]>(
        `/v1/scores/leaderboard?limit=${limit}`,
      )) ?? []
    );
  }

  async recentMatches(limit = 25): Promise<RecentMatch[]> {
    if (this.proxy) {
      return this.proxyFetch<RecentMatch>('recentMatches', { limit });
    }
    return (
      (await this.httpFetch<RecentMatch[]>(
        `/v1/scores/recent?limit=${limit}`,
      )) ?? []
    );
  }

  async submitScore(entry: ScoreSubmission): Promise<void> {
    if (this.proxy) {
      this.proxy.sendControl({
        type: 'scores.request',
        protocolVersion: 'peer-v1',
        messageId: `v1_score_${crypto.randomUUID()}`,
        sentAtMs: Date.now(),
        payload: { action: 'submitScore', entry },
      });
      return;
    }
    await this.httpPost('/v1/scores', entry);
  }

  async submitFeedback(feedback: FeedbackSubmission): Promise<void> {
    if (this.proxy) {
      this.proxy.sendControl({
        type: 'scores.request',
        protocolVersion: 'peer-v1',
        messageId: `v1_fb_${crypto.randomUUID()}`,
        sentAtMs: Date.now(),
        payload: { action: 'submitFeedback', feedback },
      });
      return;
    }
    await this.httpPost('/v1/telemetry', {
      duelId: feedback.duelId,
      playerId: feedback.playerId,
      eventType: 'feedback',
      gamesThisSession: 1,
      gameLengthTicks: 0,
      disconnected: false,
      feedbackRating: feedback.rating,
      feedbackTags: feedback.tags?.join(',') ?? '',
    });
  }

  /** Handle a scores.response from the server-peer proxy. */
  handleResponse(msg: unknown): void {
    const m = msg as Record<string, unknown> | null;
    if (m?.type !== 'scores.response') return;
    const payload = m.payload as Record<string, unknown> | null;
    if (!payload) return;
    // Responses are handled via the promise-based proxyFetch below.
    // This method exists for external dispatch compatibility.
  }

  // ─── Proxy fetch (through peer) ───────────────────────────────

  private pendingResolvers = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private proxyFetch<T>(
    action: string,
    params: Record<string, unknown>,
  ): Promise<T[]> {
    return new Promise((resolve) => {
      if (!this.proxy) {
        resolve([]);
        return;
      }

      const reqId = `v1_req_${crypto.randomUUID()}`;
      const timeout = setTimeout(() => {
        this.pendingResolvers.delete(reqId);
        resolve([]);
      }, 5000);

      this.pendingResolvers.set(reqId, {
        resolve: resolve as (d: unknown) => void,
        timeout,
      });

      this.proxy.sendControl({
        type: 'scores.request',
        protocolVersion: 'peer-v1',
        messageId: reqId,
        sentAtMs: Date.now(),
        payload: { action, ...params },
      });
    });
  }

  /** Called externally when a scores.response arrives via the control channel. */
  onScoresResponse(msg: unknown): void {
    const m = msg as Record<string, unknown> | null;
    if (m?.type !== 'scores.response') return;
    const payload = m.payload as Record<string, unknown> | null;
    if (!payload) return;
    const reqId = m.messageId as string;
    if (!reqId) return;

    const resolver = this.pendingResolvers.get(reqId);
    if (!resolver) return;
    clearTimeout(resolver.timeout);
    this.pendingResolvers.delete(reqId);
    resolver.resolve(payload.data ?? []);
  }

  // ─── Direct HTTP ──────────────────────────────────────────────

  private async httpFetch<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private async httpPost(path: string, body: unknown): Promise<void> {
    try {
      await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* silent */
    }
  }
}
