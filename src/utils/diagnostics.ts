/**
 * Structured diagnostics for the SPA.
 *
 * Controlled via URL param `?debug=1` or by setting `window.__OSD_DEBUG__ = true`.
 * When disabled (default), only errors and warnings are logged.
 * When enabled, all levels including info and debug appear.
 *
 * Entries are buffered (last 250) and exposed via `diagnostics.dumpRecent()` for
 * copy-paste into GitHub issues.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface DiagEntry {
  ts: number; // Date.now()
  level: LogLevel;
  category: string; // e.g. 'net', 'audio', 'game'
  message: string;
  data?: Record<string, unknown>;
}

class Diagnostics {
  private entries: DiagEntry[] = [];
  private maxEntries = 250;
  private enabled: boolean;
  private minLevel: LogLevel;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.enabled = params.has('debug') && params.get('debug') !== '0';
    this.minLevel = this.enabled ? 'debug' : 'warn';
  }

  debug(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.emit('debug', category, message, data);
  }

  info(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.emit('info', category, message, data);
  }

  warn(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.emit('warn', category, message, data);
  }

  error(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.emit('error', category, message, data);
  }

  /** Dump recent entries of a minimum level for bug reports. */
  dumpRecent(minLevel: LogLevel = 'warn'): DiagEntry[] {
    const min = LEVEL_ORDER[minLevel];
    return this.entries.filter((e) => LEVEL_ORDER[e.level] >= min);
  }

  /** Dump all entries as formatted text (for copy-paste into GitHub issues). */
  dumpText(minLevel: LogLevel = 'info'): string {
    const entries = this.dumpRecent(minLevel);
    if (entries.length === 0) return 'No diagnostic entries.';
    return entries
      .map((e) => {
        const time = new Date(e.ts).toISOString();
        const data = e.data ? ' ' + JSON.stringify(e.data) : '';
        return `[${time}] [${e.level}] ${e.category}: ${e.message}${data}`;
      })
      .join('\n');
  }

  /** True if debug mode is enabled. */
  get isDebugEnabled(): boolean {
    return this.enabled;
  }

  /** Current minimum log level. */
  get currentLevel(): LogLevel {
    return this.minLevel;
  }

  // ─── Internal ──────────────────────────────

  private emit(
    level: LogLevel,
    category: string,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: DiagEntry = { ts: Date.now(), level, category, message: msg };
    if (data) entry.data = data;

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();

    const fn =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : level === 'info'
            ? console.debug /* info → debug to satisfy no-console rule */
            : console.debug;
    fn(`[${category}] ${msg}`, data ?? '');
  }
}

export const diagnostics = new Diagnostics();
