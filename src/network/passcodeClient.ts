/**
 * Passcode Client — creates and resolves lobby passcodes via osd-control.
 *
 * Uses direct HTTP to osd-control (no proxy needed — passcodes are used
 * before a peer connection is established).
 */

export interface PasscodeEntry {
  code: string;
  roomId: string;
  strategy: string;
  hostName: string;
  expiresAt: string;
}

export class PasscodeClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Create a passcode for a duel room. Returns the generated code. */
  async create(
    roomId: string,
    strategy: string,
    hostName: string,
  ): Promise<PasscodeEntry | null> {
    return this.httpPost<PasscodeEntry>('/v1/passcodes', {
      roomId,
      strategy,
      hostName,
    });
  }

  /** Resolve a passcode to room info. Returns null if not found. */
  async resolve(code: string): Promise<PasscodeEntry | null> {
    const clean = code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!clean) return null;
    return this.httpGet<PasscodeEntry>(
      `/v1/passcodes/${encodeURIComponent(clean)}`,
    );
  }

  private async httpGet<T>(path: string): Promise<T | null> {
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

  private async httpPost<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
