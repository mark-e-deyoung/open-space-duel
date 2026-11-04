import { ShipClass } from '../game/engine/state';
import { toCanvas } from 'qrcode';
import { renderControlCalibration } from './controlCalibration';
import { FriendsManager } from '../network/friends';

/** Clamp a value between min and max. Used for localStorage value validation. */
function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/** Check if a server fingerprint is in the trusted set.
 * Configured via URL query `?trust=abc123,def456` or localStorage `osd_trusted_fingerprints`. */
function isTrustedFingerprint(fp: string | undefined): boolean {
  if (!fp) return false;
  const trusted = getTrustedFingerprints();
  if (trusted.length === 0) return false;
  return trusted.includes(fp.toLowerCase());
}

function getTrustedFingerprints(): string[] {
  // Check URL query param first (takes priority)
  const params = new URLSearchParams(window.location.search);
  const urlTrust = params.get('trust');
  if (urlTrust) {
    return urlTrust
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  // Fall back to localStorage
  try {
    const stored = localStorage.getItem('osd_trusted_fingerprints');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed))
        return parsed
          .map((s: unknown) => String(s).trim().toLowerCase())
          .filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function highlightStars(stars: NodeListOf<Element>, rating: number) {
  stars.forEach((s) => {
    (s as HTMLElement).style.opacity =
      Number(s.getAttribute('data-rating')) <= rating ? '1' : '0.3';
  });
}

interface Preset {
  speed: number;
  boosters: boolean;
  boosterRate: 'rare' | 'normal' | 'chaos';
  density: number;
  hazards: boolean;
  shake: number;
  multiplier: number;
}

export class MainMenu {
  public container: HTMLDivElement;
  public soundEnabled: boolean = true;
  public callSign: string = '';
  public version: string = '';

  // Pilot 1 Config
  public statFocus: number = 0;
  public selectedShipClass: ShipClass = ShipClass.Standard;

  // Pilot 2 Config (Local Multi)
  public p2StatFocus: number = 0;
  public p2SelectedShipClass: ShipClass = ShipClass.Standard;

  // Game Settings (Defaults)
  public gameSpeed: number = 1.0;
  public unlimitedEnergy: boolean = false;
  public boostersEnabled: boolean = true;
  public boosterRate: 'rare' | 'normal' | 'chaos' = 'normal';
  public asteroidDensity: number = 5;
  public hazardsEnabled: boolean = true;
  public screenShake: number = 1.0;
  public requiredWins: number = 1;
  public waveCompositions: string[] = [
    'classic',
    'anomaly',
    'blockade',
    'swarm',
  ];
  public selectedPreset: string = 'standard';
  public musicIntensityProfile: 'calm' | 'balanced' | 'tense' = 'balanced';

  // Carousel State
  private currentCardIndex: number = 0;
  private gamepadUpdateTimer: any = null;
  private statusAnimationTimer: number | null = null;

  private presets: { [key: string]: Preset } = {
    zen: {
      speed: 0.8,
      boosters: true,
      boosterRate: 'chaos',
      density: 2,
      hazards: false,
      shake: 0.5,
      multiplier: 0.5,
    },
    standard: {
      speed: 1.0,
      boosters: true,
      boosterRate: 'normal',
      density: 5,
      hazards: true,
      shake: 1.0,
      multiplier: 1.0,
    },
    tactical: {
      speed: 1.2,
      boosters: true,
      boosterRate: 'rare',
      density: 7,
      hazards: true,
      shake: 1.5,
      multiplier: 1.5,
    },
    duel: {
      speed: 1.0,
      boosters: false,
      boosterRate: 'rare',
      density: 0,
      hazards: false,
      shake: 1.0,
      multiplier: 1.0,
    },
    chaos: {
      speed: 1.3,
      boosters: true,
      boosterRate: 'chaos',
      density: 10,
      hazards: true,
      shake: 2.0,
      multiplier: 2.0,
    },
  };

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'main-menu';
    this.container.setAttribute('data-testid', 'main-menu');
    this.container.className = 'ui-element';
    this.container.style.cssText =
      'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); color: #fff; overflow: hidden; z-index: 1000;';
    parent.appendChild(this.container);
    this.loadSettings();
  }

  private loadSettings() {
    try {
      const saved = localStorage.getItem('osd_settings');
      if (saved) {
        const data = JSON.parse(saved);
        this.gameSpeed = clamp(Number(data.gameSpeed) || 1.0, 0.5, 2.0);
        this.unlimitedEnergy = data.unlimitedEnergy ?? false;
        this.boostersEnabled = data.boostersEnabled ?? true;
        this.boosterRate = data.boosterRate ?? 'normal';
        this.asteroidDensity = clamp(Number(data.asteroidDensity) || 5, 0, 10);
        this.hazardsEnabled = data.hazardsEnabled ?? true;
        this.screenShake = clamp(Number(data.screenShake) || 1.0, 0, 2.0);
        this.selectedPreset = data.selectedPreset ?? 'standard';
        this.musicIntensityProfile = data.musicIntensityProfile ?? 'balanced';
        this.waveCompositions = data.waveCompositions ?? [
          'classic',
          'anomaly',
          'blockade',
          'swarm',
        ];
        this.statFocus = clamp(Number(data.statFocus) || 0, -5, 5);
        this.selectedShipClass = data.selectedShipClass ?? ShipClass.Standard;
        this.requiredWins = clamp(Number(data.requiredWins) || 1, 1, 99);
        this.p2StatFocus = clamp(Number(data.p2StatFocus) || 0, -5, 5);
        this.p2SelectedShipClass =
          data.p2SelectedShipClass ?? ShipClass.Standard;
      }
    } catch (e) {
      console.error('[MENU] Failed to load settings', e);
    }
  }

  private saveSettings() {
    try {
      const data = {
        gameSpeed: this.gameSpeed,
        unlimitedEnergy: this.unlimitedEnergy,
        boostersEnabled: this.boostersEnabled,
        boosterRate: this.boosterRate,
        asteroidDensity: this.asteroidDensity,
        hazardsEnabled: this.hazardsEnabled,
        screenShake: this.screenShake,
        selectedPreset: this.selectedPreset,
        musicIntensityProfile: this.musicIntensityProfile,
        waveCompositions: this.waveCompositions,
        statFocus: this.statFocus,
        selectedShipClass: this.selectedShipClass,
        requiredWins: this.requiredWins,
        p2StatFocus: this.p2StatFocus,
        p2SelectedShipClass: this.p2SelectedShipClass,
      };
      localStorage.setItem('osd_settings', JSON.stringify(data));
    } catch (e) {
      console.error('[MENU] Failed to save settings', e);
    }
  }

  public calculateMultiplier(): number {
    if (this.unlimitedEnergy) return 0;
    if (this.selectedPreset !== 'custom')
      return this.presets[this.selectedPreset]!.multiplier;
    return 1.0;
  }

  public localMultiplayerPossible: boolean = false;

  public onStartLocal?: (shipClass: ShipClass, requiredWins: number) => void;
  public onStartLocalMultiplayer?: (
    p1ShipClass: ShipClass,
    p1StatFocus: number,
    p2ShipClass: ShipClass,
    p2StatFocus: number,
    requiredWins: number,
  ) => void;
  public onHostGame?: (
    strategy: 'nostr' | 'torrent' | 'manual',
    shipClass: ShipClass,
    requiredWins: number,
  ) => void;
  public onJoinGame?: (invite: string) => void;
  public onJoinDiscoveredGame?: (
    roomId: string,
    strategy: 'nostr' | 'torrent',
  ) => void;
  /** Called when joining a server-peer (ARENA) duel. */
  public onJoinServerDuel?: (
    duelId: string,
    roomId: string,
    strategy: 'nostr' | 'torrent',
    inviteCode?: string,
    turnUrls?: string[],
    turnUsername?: string,
    turnCredential?: string,
  ) => void;
  public onShowLeaderboard?: () => void;
  public onWatchDuel?: (duelId: string, strategy: 'nostr' | 'torrent') => void;
  public onAcceptResponse?: (responsePayload: string) => void;
  public onRegenerateCallSign?: () => string;
  public onSoundToggle?: (enabled: boolean) => void;
  public onMusicIntensityProfileChange?: (
    profile: 'calm' | 'balanced' | 'tense',
  ) => void;
  public onCancel?: () => void;
  /** Passcode callbacks */
  public onCreatePasscode?: (
    roomId: string,
    strategy: string,
    hostName: string,
  ) => Promise<string | null>;
  public onResolvePasscode?: (
    code: string,
  ) => Promise<{ roomId: string; strategy: string } | null>;
  public onCopyDuelLink?: (link: string) => void;
  public onShareDuelLink?: (link: string) => void;
  /** Friends callbacks */
  public onAddFriend?: (playerId: string, callSign?: string) => void;
  public onRemoveFriend?: (playerId: string) => void;
  public onCopyFriendCode?: (code: string) => void;
  public onShareFriendCode?: (code: string) => void;
  public onShowFriendQR?: (code: string) => void;
  public onInviteFriend?: (friendId: string) => void;
  public onUpdateFriends?: (friendsHtml: string) => void;

  public show() {
    this.container.style.display = 'block';
    this.renderInitialMenu();
  }

  public hide() {
    this.container.style.display = 'none';
    if (this.gamepadUpdateTimer) clearInterval(this.gamepadUpdateTimer);
    if (this.statusAnimationTimer) clearInterval(this.statusAnimationTimer);
    this.statusAnimationTimer = null;
    // Remove the cloned sound toggle when menu hides (recreated on show)
    const clone = document.getElementById('btn-global-sound-clone');
    if (clone) clone.remove();
  }

  private clearStatusAnimation() {
    if (this.statusAnimationTimer) clearInterval(this.statusAnimationTimer);
    this.statusAnimationTimer = null;
  }

  private startStatusAnimation(
    target: HTMLElement | null,
    label: string,
    frames: string[] = ['◐', '◓', '◑', '◒'],
  ) {
    this.clearStatusAnimation();
    if (!target) return;

    let index = 0;
    const update = () => {
      target.innerText = `${label} ${frames[index % frames.length]}`;
      index += 1;
    };

    update();
    this.statusAnimationTimer = window.setInterval(update, 320);
  }

  /** Current game filter: 'all', 'people', or 'bots'. */
  private gameFilter: 'all' | 'pilots' | 'bots' = 'all';

  /** Wire filter button click handlers (called after render). */
  private wireGameFilters(): void {
    const updateFilter = (filter: 'all' | 'pilots' | 'bots') => {
      this.gameFilter = filter;
      // Re-trigger lobby update — the lobby holds the games, not the menu
      // Instead, we re-render with the last known games
      const lastGames = (window as any).__osdLastGames;
      if (lastGames) this.updatePublicGames(lastGames);
      // Update button styles
      this.container.querySelectorAll('.game-filter-btn').forEach((btn) => {
        const b = btn as HTMLElement;
        if (b.id === 'filter-' + filter) {
          b.style.background = '#ffaa00';
          b.style.color = '#000';
          b.style.fontWeight = 'bold';
        } else {
          b.style.background = '#333';
          b.style.color = '#888';
          b.style.fontWeight = 'normal';
        }
      });
    };

    const btnAll = this.container.querySelector('#filter-all');
    const btnPeople = this.container.querySelector('#filter-people');
    const btnBots = this.container.querySelector('#filter-bots');
    if (btnAll) (btnAll as HTMLElement).onclick = () => updateFilter('all');
    if (btnPeople)
      (btnPeople as HTMLElement).onclick = () => updateFilter('pilots');
    if (btnBots) (btnBots as HTMLElement).onclick = () => updateFilter('bots');
  }

  public updatePublicGames(games: any[]) {
    const list = this.container.querySelector('#public-games-list');
    if (!list) return;

    // Store last games for filter re-renders
    (window as any).__osdLastGames = games;

    // Apply filter
    let filtered = games;
    if (this.gameFilter === 'pilots') {
      filtered = games.filter((g) => g.source !== 'server-peer');
    } else if (this.gameFilter === 'bots') {
      filtered = games.filter((g) => g.source === 'server-peer');
    }

    // Sort: people (P2P) first, then bots (server-peer)
    filtered = [...filtered].sort((a, b) => {
      const aIsServer = a.source === 'server-peer' ? 1 : 0;
      const bIsServer = b.source === 'server-peer' ? 1 : 0;
      return aIsServer - bIsServer;
    });

    if (filtered.length === 0) {
      const msg =
        this.gameFilter === 'all'
          ? 'No active duels in range.'
          : this.gameFilter === 'pilots'
            ? 'No pilot-hosted duels found.'
            : 'No bot arenas available.';
      list.innerHTML =
        '<p style="font-size: 11px; color: #666; text-align: center;">' +
        msg +
        '</p>';
      return;
    }

    list.innerHTML = filtered
      .map((g) => {
        const isServer = g.source === 'server-peer';
        const needsCode = isServer && !!g.requiresInviteCode;
        const isVerified = isServer && isTrustedFingerprint(g.fingerprint);
        const badgeColor = isServer ? '#00ffcc' : '#ffaa00';
        const badgeLabel = isServer
          ? isVerified
            ? 'VERIFIED'
            : 'ARENA'
          : 'PILOT';
        const borderColor = isVerified
          ? '#ffcc00'
          : isServer
            ? '#00ffcc'
            : '#ffaa00';
        const bgColor = isServer
          ? isVerified
            ? 'rgba(255,204,0,0.08)'
            : 'rgba(0,255,204,0.08)'
          : 'rgba(255,170,0,0.1)';

        // Build slot preview for server duels (show bot opponents)
        let slotHtml = '';
        if (isServer && g.slots && g.slots.length > 0) {
          const botSlots = g.slots.filter(
            (s: any) => s.playerKind === 'bot' && s.status === 'occupied',
          );
          if (botSlots.length > 0) {
            slotHtml =
              '<div style="font-size: 8px; color: #888; margin-top: 2px;">' +
              botSlots
                .map((s: any) => '🤖 ' + (s.displayName || 'BOT'))
                .join(' • ') +
              '</div>';
          }
        }

        // State indicator
        const stateLabel =
          g.state === 'running'
            ? ' IN PLAY'
            : g.state === 'closed'
              ? ' CLOSED'
              : '';

        return (
          '<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px; background: ' +
          bgColor +
          '; border: 1px solid ' +
          borderColor +
          '; border-radius: 4px; margin-bottom: 5px;">' +
          '<div style="text-align: left; flex: 1; min-width: 0;">' +
          '<div style="display: flex; align-items: center; gap: 4px;">' +
          '<span style="font-size: 9px; padding: 1px 4px; border-radius: 2px; background: ' +
          badgeColor +
          '; color: #000; font-weight: bold;">' +
          badgeLabel +
          '</span>' +
          '<span style="font-size: 10px; color: ' +
          badgeColor +
          '; font-weight: bold;">' +
          (g.hostName || g.callSign || 'UNKNOWN PILOT') +
          (stateLabel
            ? '<span style="font-size: 8px; color: #888;">' +
              stateLabel +
              '</span>'
            : '') +
          '</span>' +
          '</div>' +
          '<div style="font-size: 8px; color: #888;">' +
          g.strategy.toUpperCase() +
          ' • ' +
          (g.version || 'local') +
          '</div>' +
          slotHtml +
          (needsCode
            ? '<div style="font-size: 8px; color: #ffcc00; margin-top: 2px;">🔒 CODE REQUIRED</div>'
            : '') +
          '</div>' +
          '<div style="display: flex; gap: 3px;">' +
          (g.state === 'running'
            ? '<button class="btn-watch-duel" data-testid="watch-game-' +
              g.duelId +
              '" data-id="' +
              g.duelId +
              '" data-strategy="' +
              g.strategy +
              '" style="padding: 3px 6px; background: #444; color: #fff; border: 1px solid #666; border-radius: 2px; font-size: 8px; cursor: pointer;">👁 WATCH</button>'
            : '') +
          '<button class="btn-join-public" data-testid="join-game-' +
          g.duelId +
          '" data-id="' +
          g.duelId +
          '" data-strategy="' +
          g.strategy +
          '" data-source="' +
          (g.source || 'p2p') +
          '" data-needs-code="' +
          (needsCode ? '1' : '0') +
          '" data-turn-urls="' +
          (g.turnInfo?.urls?.join(',') || '') +
          '" data-turn-username="' +
          (g.turnInfo?.username || '') +
          '" data-turn-credential="' +
          (g.turnInfo?.credential || '') +
          '" style="padding: 3px 8px; background: ' +
          badgeColor +
          '; color: #000; border: none; border-radius: 2px; font-size: 9px; font-weight: bold; cursor: pointer;">JOIN</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    list.querySelectorAll('.btn-join-public').forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = btn.getAttribute('data-id');
        const strategy = btn.getAttribute('data-strategy') as
          | 'nostr'
          | 'torrent';
        const source = btn.getAttribute('data-source') || 'p2p';
        const needsCode = btn.getAttribute('data-needs-code') === '1';
        const turnUrlsStr = btn.getAttribute('data-turn-urls');
        const turnUsername =
          btn.getAttribute('data-turn-username') || undefined;
        const turnCredential =
          btn.getAttribute('data-turn-credential') || undefined;
        const turnUrls = turnUrlsStr
          ? turnUrlsStr.split(',').filter(Boolean)
          : undefined;
        if (id && strategy) {
          if (source === 'server-peer' && this.onJoinServerDuel) {
            if (needsCode) {
              this.showInviteCodePrompt(id, strategy);
            } else {
              this.onJoinServerDuel(
                id,
                id,
                strategy,
                undefined,
                turnUrls,
                turnUsername,
                turnCredential,
              );
            }
          } else if (this.onJoinDiscoveredGame) {
            this.onJoinDiscoveredGame(id, strategy);
          }
        }
      };
    });

    list.querySelectorAll('.btn-watch-duel').forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = btn.getAttribute('data-id');
        const strategy = btn.getAttribute('data-strategy') as
          | 'nostr'
          | 'torrent';
        if (id && strategy && this.onWatchDuel) {
          this.onWatchDuel(id, strategy);
        }
      };
    });
    this.wireGameFilters();
  }

  public updateConnectionStatus(status: string) {
    const statusEl = this.container.querySelector('#connection-status');
    if (statusEl) {
      statusEl.textContent = status;
    }
  }

  public showGameOver(
    scores: { [id: string]: number },
    playerCallSigns: { [id: string]: string },
    matchWinner: string | null,
    onContinue: () => void,
    onFeedback?: (rating: number) => void,
  ) {
    this.hide();
    const overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'game-over-screen');
    overlay.style.cssText =
      'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 2000; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; overflow-y: auto; padding: 40px 0; box-sizing: border-box;';

    let scoreHtml = '';
    for (const id in scores) {
      const name = playerCallSigns[id]! || id;
      scoreHtml +=
        '<p style="font-size: 24px; margin: 10px 0;">' +
        name +
        ': ' +
        scores[id]! +
        '</p>';
    }

    const winnerName = matchWinner
      ? playerCallSigns[matchWinner]! || matchWinner
      : 'TIE';

    // Feedback stars
    let feedbackHtml = '';
    if (onFeedback) {
      feedbackHtml =
        '<div data-testid="post-game-feedback" style="margin: 20px 0; text-align: center;">' +
        '<p style="font-size: 14px; color: #888; margin-bottom: 10px;">How was this match?</p>' +
        '<div id="feedback-stars" style="display: flex; gap: 8px; justify-content: center; cursor: pointer;">' +
        [1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<span class="feedback-star" data-rating="${n}" style="font-size: 36px; opacity: 0.4; transition: opacity 0.15s; user-select: none;">⭐</span>`,
          )
          .join('') +
        '</div>' +
        '<p id="feedback-label" style="font-size: 11px; color: #666; margin-top: 6px; min-height: 16px;"></p>' +
        '</div>';
    }

    overlay.innerHTML =
      '<h1 style="color: #00ffcc; font-size: 48px; margin-bottom: 20px;" data-testid="game-over-title">' +
      (matchWinner ? 'SERIES COMPLETE' : 'MISSION OVER') +
      '</h1>' +
      (matchWinner
        ? '<h2 style="color: #ffaa00; font-size: 32px; margin-bottom: 30px;">WINNER: ' +
          winnerName +
          '</h2>'
        : '') +
      '<div data-testid="final-scores" style="margin-bottom: 20px; text-align: center;">' +
      scoreHtml +
      '</div>' +
      feedbackHtml +
      '<button id="btn-game-over-ok" data-testid="restart-btn" style="padding: 15px 40px; font-size: 20px; background: #00ffcc; color: #000; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">RETURN TO BASE</button>' +
      '<div id="share-buttons" style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; max-width: 400px;"></div>';

    document.body.appendChild(overlay);

    // Wire feedback stars
    if (onFeedback) {
      const stars = overlay.querySelectorAll('.feedback-star');
      let submitted = false;
      stars.forEach((star) => {
        (star as HTMLElement).onmouseenter = () =>
          highlightStars(stars, Number(star.getAttribute('data-rating')));
        (star as HTMLElement).onclick = () => {
          if (submitted) return;
          submitted = true;
          const rating = Number(star.getAttribute('data-rating'));
          onFeedback(rating);
          stars.forEach((s) => {
            (s as HTMLElement).style.opacity = '1';
          });
          const label = overlay.querySelector('#feedback-label');
          if (label) label.textContent = 'Thanks for the feedback!';
        };
      });
      const starsContainer = overlay.querySelector('#feedback-stars');
      if (starsContainer) {
        starsContainer.addEventListener('mouseleave', () => {
          if (!submitted) highlightStars(stars, 0);
        });
      }
    }

    const btn = overlay.querySelector('#btn-game-over-ok') as HTMLButtonElement;
    btn.onclick = () => {
      document.body.removeChild(overlay);
      onContinue();
    };

    // Render share buttons after overlay is in the DOM
    const shareContainer = overlay.querySelector('#share-buttons');
    if (shareContainer)
      this.renderShareButtons(
        shareContainer as HTMLElement,
        scores,
        playerCallSigns,
        matchWinner,
      );
  }

  public showLeaderboard(
    entries: Array<{
      playerName: string;
      score: number;
      matches: number;
      wins: number;
    }>,
    onClose: () => void,
  ) {
    this.hide();
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 2000; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; padding: 20px; box-sizing: border-box;';

    let rows = '';
    if (entries.length === 0) {
      rows =
        '<p style="color: #666; text-align: center;">No scores yet. Fight some bots!</p>';
    } else {
      rows = entries
        .map(
          (e, i) =>
            `<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; width: 100%; max-width: 400px;">
          <span style="color: #888; width: 30px;">${i + 1}</span>
          <span style="flex: 1; color: ${i === 0 ? '#ffcc00' : '#fff'};">${e.playerName}</span>
          <span style="color: #00ffcc; font-weight: bold; width: 60px; text-align: right;">${e.score.toLocaleString()}</span>
          <span style="color: #888; width: 60px; text-align: right; font-size: 11px;">${e.wins}W ${e.matches - e.wins}L</span>
        </div>`,
        )
        .join('');
    }

    overlay.innerHTML =
      '<h1 style="color: #ffcc00; font-size: 32px; margin-bottom: 6px;">🏆 LEADERBOARD</h1>' +
      '<p style="color: #888; font-size: 11px; margin-bottom: 20px;">High scores across all pilots</p>' +
      '<div style="width: 100%; max-width: 420px; max-height: 55vh; overflow-y: auto; margin-bottom: 20px;">' +
      rows +
      '</div>' +
      '<button id="btn-leaderboard-close" style="padding: 12px 30px; background: #00ffcc; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">CLOSE</button>';

    document.body.appendChild(overlay);
    overlay
      .querySelector('#btn-leaderboard-close')!
      .addEventListener('click', () => {
        document.body.removeChild(overlay);
        onClose();
      });
  }

  public showWaitingForGuest(
    payload: string,
    isOffer: boolean,
    isLoading: boolean = false,
  ) {
    this.clearStatusAnimation();
    this.container.innerHTML =
      '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">' +
      '<h2 style="color: #ffaa00;" data-testid="hosting-match-title">' +
      (isLoading ? 'FORGING PRIVATE DUEL LINK...' : 'WAITING FOR OPPONENT...') +
      '</h2>' +
      '<div style="margin: 20px 0; padding: 20px; background: rgba(255,170,0,0.1); border: 1px solid #ffaa00; border-radius: 8px; width: 100%; max-width: 400px;">' +
      '<div data-testid="lobby-activity-indicator" style="font-size: 12px; color: #00ffcc; font-weight: bold; text-align: center; margin-bottom: 12px;">PRIVATE DUEL SIGNAL...</div>' +
      '<p style="font-size: 12px; color: #fff; margin-bottom: 15px; text-align: center;">' +
      (isOffer
        ? payload
          ? 'Transmit this private duel link to your opponent:'
          : 'Forging your private duel link. Stand by...'
        : 'Copy this join link for your opponent:') +
      '</p>' +
      '<textarea id="invite-payload" data-testid="invite-link-input" readonly style="width: 100%; height: 80px; background: #000; color: #00ffcc; border: 1px solid #333; font-family: monospace; font-size: 10px; padding: 10px; box-sizing: border-box; margin-bottom: 10px;">' +
      (payload || 'GENERATING DUEL LINK...') +
      '</textarea>' +
      '<button id="btn-copy-invite" data-testid="copy-link-btn" style="width: 100%; padding: 10px 20px; cursor: pointer; background: #ffaa00; color: #000; border: none; font-weight: bold; border-radius: 4px;" ' +
      (!payload ? 'disabled' : '') +
      '>' +
      (payload ? 'COPY LINK' : 'LINK PENDING...') +
      '</button>' +
      '</div>' +
      (isOffer
        ? '<div style="margin-top: 20px; width: 100%; max-width: 400px;">' +
          '<p style="font-size: 12px; color: #888; margin-bottom: 10px;">Paste their reply link here:</p>' +
          '<input type="text" id="response-payload-input" data-testid="response-input" placeholder="Paste reply link here..." style="width: 100%; padding: 10px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px; box-sizing: border-box; margin-bottom: 10px;">' +
          '<button id="btn-accept-response" data-testid="connect-btn" style="padding: 10px 20px; cursor: pointer; background: #222; color: #ffaa00; border: 1px solid #ffaa00; font-weight: bold; border-radius: 4px;">CONNECT</button>' +
          '</div>'
        : '') +
      '<button id="btn-cancel-sync" data-testid="cancel-btn" style="margin-top: 30px; padding: 10px 20px; cursor: pointer; background: #333; color: #fff; border: none; border-radius: 4px;">CANCEL</button>' +
      '</div>';

    const copyBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-copy-invite');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (!payload) return;
        navigator.clipboard.writeText(payload);
        copyBtn.innerText = 'COPIED!';
        setTimeout(() => (copyBtn.innerText = 'COPY LINK'), 2000);
      };
    }

    const cancelBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-cancel-sync');
    if (cancelBtn && this.onCancel) cancelBtn.onclick = this.onCancel;

    const acceptBtn = this.container.querySelector<HTMLButtonElement>(
      '#btn-accept-response',
    );
    if (acceptBtn) {
      acceptBtn.onclick = () => {
        const input = this.container.querySelector<HTMLInputElement>(
          '#response-payload-input',
        );
        if (input && input.value && this.onAcceptResponse) {
          this.onAcceptResponse(input.value);
        }
      };
    }

    const indicator = this.container.querySelector<HTMLElement>(
      '[data-testid="lobby-activity-indicator"]',
    );
    this.startStatusAnimation(
      indicator,
      isLoading ? 'FORGING PRIVATE DUEL LINK' : 'PRIVATE DUEL SIGNAL',
    );
  }

  public showLobbyStatus(title: string, message: string) {
    this.clearStatusAnimation();
    this.container.innerHTML =
      '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">' +
      '<h2 style="color: #ffaa00; text-align: center;" data-testid="hosting-match-title">' +
      title +
      '</h2>' +
      '<div style="margin: 20px 0; padding: 20px; background: rgba(255,170,0,0.1); border: 1px solid #ffaa00; border-radius: 8px; width: 100%; max-width: 420px; text-align: center;">' +
      '<div data-testid="lobby-activity-indicator" style="font-size: 12px; color: #00ffcc; font-weight: bold; margin-bottom: 12px;">ARENA SIGNAL LOCKING...</div>' +
      '<p data-testid="lobby-status-message" style="font-size: 12px; color: #fff; margin: 0;">' +
      message +
      '</p>' +
      '</div>' +
      '<p style="font-size: 12px; color: #888; margin: 0 0 20px 0;">Use the duel arena to match with another pilot.</p>' +
      '<button id="btn-cancel-sync" data-testid="cancel-btn" style="padding: 10px 20px; cursor: pointer; background: #333; color: #fff; border: none; border-radius: 4px;">CANCEL</button>' +
      '</div>';

    const cancelBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-cancel-sync');
    if (cancelBtn && this.onCancel) cancelBtn.onclick = this.onCancel;

    const indicator = this.container.querySelector<HTMLElement>(
      '[data-testid="lobby-activity-indicator"]',
    );
    this.startStatusAnimation(indicator, 'ARENA SIGNAL LOCKING');
  }

  // ── Duel link / QR code ─────────────────────────────────────────────

  /** Show the generated private duel link with QR code. Call after creating link. */
  public showDuelLink(link: string, passcode?: string | null): void {
    const output = this.container.querySelector(
      '#duel-link-output',
    ) as HTMLElement;
    const textarea = this.container.querySelector(
      '#duel-link-text',
    ) as HTMLTextAreaElement;
    const canvas = this.container.querySelector(
      '#duel-qr-canvas',
    ) as HTMLCanvasElement;
    if (output) output.style.display = 'block';
    if (textarea) textarea.value = link;

    // Generate QR code on canvas
    if (canvas) {
      this.renderQRCode(canvas, link);
    }

    // Render platform share buttons below QR
    const shareRow = this.container.querySelector('#duel-link-share-row');
    if (shareRow) {
      const encodedLink = encodeURIComponent(link);
      shareRow.innerHTML = [
        '<button class="share-platform" data-url="' +
          `https://twitter.com/intent/tweet?text=${encodeURIComponent('Join my Open Space Duel! ⚔️🛸')}&url=${encodedLink}` +
          '" style="padding:4px 8px;background:#333;color:#ccc;border:none;border-radius:3px;cursor:pointer;font-size:12px;" title="Share on X">𝕏</button>',
        '<button class="share-platform" data-url="' +
          `mailto:?subject=${encodeURIComponent('Join my duel!')}&body=${encodeURIComponent(link)}` +
          '" style="padding:4px 8px;background:#333;color:#ccc;border:none;border-radius:3px;cursor:pointer;font-size:12px;" title="Email link">📧</button>',
        '<button class="share-platform" data-url="' +
          `tg://msg?text=${encodeURIComponent('Join my Open Space Duel! ' + link)}` +
          '" style="padding:4px 8px;background:#333;color:#ccc;border:none;border-radius:3px;cursor:pointer;font-size:12px;" title="Share on Telegram">✈️</button>',
        '<button class="share-platform" data-url="" style="padding:4px 8px;background:#333;color:#ccc;border:none;border-radius:3px;cursor:pointer;font-size:12px;" title="Copy link">📋</button>',
      ].join('');

      shareRow.querySelectorAll('.share-platform').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = (btn as HTMLElement).getAttribute('data-url');
          if (url) {
            window.open(
              url,
              '_blank',
              'width=600,height=400,noopener,noreferrer',
            );
          } else {
            navigator.clipboard
              .writeText(link)
              .catch((err) => console.warn('[catch]', err));
            (btn as HTMLElement).textContent = '✓';
            setTimeout(() => ((btn as HTMLElement).textContent = '📋'), 1500);
          }
        });
      });
    }

    // If we got a passcode, show it near the QR code
    if (passcode) {
      const statusEl = this.container.querySelector(
        '#passcode-status',
      ) as HTMLElement;
      if (statusEl) {
        statusEl.textContent = `Passcode: ${passcode} (valid 30 min)`;
        statusEl.style.color = '#ffcc00';
      }
      // Also auto-fill the passcode input so guest can see it
      const pInput = this.container.querySelector(
        '#passcode-input',
      ) as HTMLInputElement;
      if (pInput) {
        pInput.value = passcode;
        setTimeout(() => {
          pInput.value = '';
        }, 5000);
      }
    }
  }

  private async renderQRCode(
    canvas: HTMLCanvasElement,
    data: string,
  ): Promise<void> {
    const size = 240;
    try {
      await toCanvas(canvas, data, {
        width: size,
        margin: 1,
        color: { dark: '#000', light: '#fff' },
      });
    } catch {
      // Fallback: clear canvas
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
      }
    }
  }

  // ── Share buttons ────────────────────────────────────────────────────

  /** Render platform share buttons into a container element. */
  private renderShareButtons(
    container: HTMLElement,
    scores: { [id: string]: number },
    callSigns: { [id: string]: string },
    winner: string | null,
  ): void {
    const text = this.buildShareText(scores, callSigns, winner);
    const encoded = encodeURIComponent(text);
    const url = window.location.origin + window.location.pathname;
    const encodedUrl = encodeURIComponent(url);

    // Mobile-first: try Web Share API
    const nativeLabel = '📤 SHARE';
    if (typeof navigator !== 'undefined' && navigator.share) {
      const btn = this.makeShareButton(nativeLabel, '#ffaa00', '#ffcc00');
      btn.onclick = () => {
        navigator
          .share({ title: 'Open Space Duel', text, url })
          .catch((err) => console.warn('[catch]', err));
      };
      container.appendChild(btn);
    }

    // Platform intent buttons (all open in a popup, no backend needed)
    const platforms = [
      {
        label: '𝕏',
        title: 'Share on X/Twitter',
        color: '#888',
        url: `https://twitter.com/intent/tweet?text=${encoded}`,
      },
      {
        label: '📧',
        title: 'Share via Email',
        color: '#666',
        url: `mailto:?subject=${encodeURIComponent('Open Space Duel results')}&body=${encodeURIComponent(text + '\n\n' + url)}`,
      },
      {
        label: 'R',
        title: 'Share on Reddit',
        color: '#ff4500',
        url: `https://reddit.com/submit?url=${encodedUrl}&title=${encoded}`,
      },
      {
        label: '✈️',
        title: 'Share on Telegram',
        color: '#0088cc',
        url: `tg://msg?text=${encodeURIComponent(text + ' ' + url)}`,
      },
      { label: '📋', title: 'Copy text', color: '#555', url: '' },
    ];

    for (const p of platforms) {
      const btn = this.makeShareButton(p.label, p.color, '#fff');
      btn.title = p.title;
      if (p.label === '📋') {
        btn.onclick = () => {
          navigator.clipboard
            .writeText(text + '\n' + url)
            .catch((err) => console.warn('[catch]', err));
          btn.textContent = '✓';
          setTimeout(() => (btn.textContent = '📋'), 1500);
        };
      } else {
        btn.onclick = () => {
          window.open(
            p.url,
            '_blank',
            'width=600,height=400,noopener,noreferrer',
          );
        };
      }
      container.appendChild(btn);
    }
  }

  private buildShareText(
    scores: { [id: string]: number },
    callSigns: { [id: string]: string },
    winner: string | null,
  ): string {
    const parts: string[] = [];
    for (const id in scores) {
      const name = callSigns[id]! || 'Pilot';
      parts.push(`${name}: ${scores[id]!}`);
    }
    const scoreLine = parts.join(' • ');
    if (winner) {
      const winnerName = callSigns[winner]! || winner;
      return `🏆 ${winnerName} won an Open Space Duel! ${scoreLine} ⚔️🛸`;
    }
    return `🎮 Open Space Duel — ${scoreLine} ⚔️🛸`;
  }

  private makeShareButton(
    label: string,
    bg: string,
    fg: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      `padding: 6px 10px; cursor: pointer;`,
      `background: ${bg}; color: ${fg}; border: none;`,
      `border-radius: 4px; font-size: 11px; font-weight: bold;`,
      `min-width: 36px;`,
    ].join(' ');
    return btn;
  }

  // ── Friends panel ────────────────────────────────────────────────────

  /** Set the player's own friend code in the UI (shows 6-digit short code). */
  public setFriendCode(code: string): void {
    const el = this.container.querySelector('#friend-code-value');
    if (el) el.textContent = FriendsManager.generateFriendCode(code);
  }

  /** Render the friends list in the UI. */
  public renderFriends(
    friends: Array<{ playerId: string; callSign: string; online: boolean }>,
  ): void {
    const list = this.container.querySelector('#friends-list');
    if (!list) return;
    if (friends.length === 0) {
      list.innerHTML =
        '<div style="color: #555; font-size: 9px; padding: 4px;">No friends added. Add a friend code to see them here.</div>';
    } else {
      list.innerHTML = friends
        .map(
          (f) =>
            '<div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 4px; border-bottom: 1px solid #222;">' +
            '<div style="display: flex; align-items: center; gap: 4px;">' +
            '<span style="font-size: 10px; color: ' +
            (f.online ? '#00ffcc' : '#555') +
            ';">' +
            (f.online ? '🟢' : '⚫') +
            '</span>' +
            '<span style="font-size: 10px; color: ' +
            (f.online ? '#fff' : '#666') +
            ';">' +
            (f.callSign || 'Pilot') +
            '</span>' +
            '</div>' +
            (f.online
              ? '<button class="btn-invite-friend" data-friend-id="' +
                f.playerId +
                '" style="padding: 2px 8px; background: #00ffcc; color: #000; border: none; border-radius: 2px; font-size: 8px; cursor: pointer;">INVITE</button>'
              : '<span style="font-size: 8px; color: #444;">OFFLINE</span>') +
            '<button class="btn-remove-friend" data-friend-id="' +
            f.playerId +
            '" style="padding: 1px 4px; background: none; border: none; color: #666; cursor: pointer; font-size: 9px;">✕</button>' +
            '</div>',
        )
        .join('');

      // Wire invite buttons
      list.querySelectorAll('.btn-invite-friend').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fid = (btn as HTMLElement).getAttribute('data-friend-id');
          if (fid && this.onInviteFriend) {
            this.onInviteFriend(fid);
            // Brief feedback
            const origText = (btn as HTMLElement).textContent || '';
            (btn as HTMLElement).textContent = '✓ SENT';
            setTimeout(() => {
              (btn as HTMLElement).textContent = origText;
            }, 2000);
          }
        });
      });
      // Wire remove buttons
      list.querySelectorAll('.btn-remove-friend').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fid = (btn as HTMLElement).getAttribute('data-friend-id');
          if (fid && this.onRemoveFriend) this.onRemoveFriend(fid);
        });
      });
    }

    // Update online count
    const online = friends.filter((f) => f.online).length;
    const countEl = this.container.querySelector('#friends-online-count');
    if (countEl) countEl.textContent = online > 0 ? `${online} online` : '';
  }

  public showInviteCodePrompt(duelId: string, strategy: 'nostr' | 'torrent') {
    this.clearStatusAnimation();
    this.container.innerHTML =
      '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">' +
      '<h2 style="color: #ffcc00;" data-testid="invite-code-title">🔒 ARENA CODE REQUIRED</h2>' +
      '<div style="margin: 20px 0; padding: 20px; background: rgba(255,204,0,0.1); border: 1px solid #ffcc00; border-radius: 8px; width: 100%; max-width: 400px;">' +
      '<p style="font-size: 12px; color: #fff; margin-bottom: 15px; text-align: center;">This arena requires an invite code to join. Enter the code provided by the host:</p>' +
      '<input type="text" id="invite-code-input" data-testid="invite-code-input" placeholder="Enter invite code..." style="width: 100%; padding: 10px; background: #111; color: #ffcc00; border: 1px solid #ffcc00; border-radius: 4px; box-sizing: border-box; margin-bottom: 10px; font-size: 16px; text-align: center; text-transform: uppercase; letter-spacing: 2px;" maxlength="20" autofocus>' +
      '<button id="btn-submit-code" data-testid="submit-code-btn" style="width: 100%; padding: 10px 20px; cursor: pointer; background: #ffcc00; color: #000; border: none; font-weight: bold; border-radius: 4px;">ENTER ARENA</button>' +
      '</div>' +
      '<button id="btn-cancel-code" data-testid="cancel-code-btn" style="margin-top: 15px; padding: 10px 20px; cursor: pointer; background: #333; color: #fff; border: none; border-radius: 4px;">CANCEL</button>' +
      '</div>';

    const submitBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-submit-code');
    const cancelBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-cancel-code');
    const input =
      this.container.querySelector<HTMLInputElement>('#invite-code-input');

    if (submitBtn && input) {
      submitBtn.onclick = () => {
        const code = input.value.trim();
        if (code && this.onJoinServerDuel) {
          this.onJoinServerDuel(duelId, duelId, strategy, code);
        }
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && submitBtn) submitBtn.click();
      };
    }

    if (cancelBtn && this.onCancel) {
      cancelBtn.onclick = this.onCancel;
    }

    // Auto-focus the input
    setTimeout(() => input?.focus(), 100);
  }

  public showGuestAnswering(payload: string) {
    this.clearStatusAnimation();
    this.container.innerHTML =
      '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">' +
      '<h2 style="color: #ffaa00;" data-testid="joining-match-title">GENERATING REPLY...</h2>' +
      '<div style="margin: 20px 0; padding: 20px; background: rgba(255,170,0,0.1); border: 1px solid #ffaa00; border-radius: 8px; width: 100%; max-width: 400px;">' +
      '<p style="font-size: 12px; color: #fff; margin-bottom: 15px;">Send this reply link back to the host:</p>' +
      '<textarea data-testid="response-link-output" readonly style="width: 100%; height: 80px; background: #000; color: #00ffcc; border: 1px solid #333; font-family: monospace; font-size: 10px; padding: 10px; box-sizing: border-box; margin-bottom: 10px;">' +
      payload +
      '</textarea>' +
      '<button id="btn-copy-res" style="width: 100%; padding: 10px 20px; cursor: pointer; background: #ffaa00; color: #000; border: none; font-weight: bold; border-radius: 4px;">COPY LINK</button>' +
      '</div>' +
      '<p style="font-size: 12px; color: #888;">Once the host accepts this reply, the duel begins.</p>' +
      '<button id="btn-cancel-sync" style="margin-top: 30px; padding: 10px 20px; cursor: pointer; background: #333; color: #fff; border: none; border-radius: 4px;">CANCEL</button>' +
      '</div>';

    const copyBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-copy-res');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(payload);
        copyBtn.innerText = 'COPIED!';
        setTimeout(() => (copyBtn.innerText = 'COPY LINK'), 2000);
      };
    }

    const cancelBtn =
      this.container.querySelector<HTMLButtonElement>('#btn-cancel-sync');
    if (cancelBtn && this.onCancel) cancelBtn.onclick = this.onCancel;
  }

  private getShipSVG(shipClass: ShipClass, color: string = '#00ffcc'): string {
    let path = '';
    if (shipClass === ShipClass.Interceptor) {
      path = 'M 12,0 L -8,5 L -4,0 L -8,-5 Z';
    } else if (shipClass === ShipClass.Dreadnought) {
      path = 'M 10,8 L 10,-8 L -5,-8 L -5,-3 L 2,-3 L 2,3 L -5,3 L -5,8 Z';
    } else {
      path = 'M 10,0 L -10,8 L -5,0 L -10,-8 Z';
    }
    return (
      '<svg aria-hidden="true" focusable="false" width="50" height="50" viewBox="-15 -15 30 30" style="filter: drop-shadow(0 0 8px ' +
      color +
      ');">' +
      '<path d="' +
      path +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="2" stroke-linejoin="round" />' +
      '</svg>'
    );
  }

  private renderCard(index: number): string {
    const cardStyle =
      'flex: 0 0 100%; width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: safe center; overflow-y: auto; overscroll-behavior-y: contain; padding: calc(72px + env(safe-area-inset-top, 0px)) 20px calc(80px + env(safe-area-inset-bottom, 0px)) 20px; box-sizing: border-box; scroll-snap-align: start;';

    switch (index) {
      case 0: // PILOT 1
        return (
          '<div class="menu-card" style="' +
          cardStyle +
          '">' +
          '<h2 style="color: #00ffcc; margin-bottom: 20px; font-size: 20px;">PILOT 1 CONFIG</h2>' +
          '<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; justify-content: center;">' +
          '<div data-testid="call-sign-display" style="font-size: 24px; font-weight: bold;">' +
          this.callSign +
          '</div>' +
          '<button id="btn-regen-name-inline" style="min-width: 44px; min-height: 44px; box-sizing: border-box; flex-shrink: 0; background: #222; border: 1px solid #333; color: #00ffcc; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 16px;">🔄</button>' +
          '</div>' +
          '<div role="group" aria-label="Pilot 1 ship class" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">' +
          [ShipClass.Interceptor, ShipClass.Standard, ShipClass.Dreadnought]
            .map(
              (sc) =>
                '<button type="button" class="p1-ship-card ' +
                (this.selectedShipClass === sc ? 'active' : '') +
                '" data-class="' +
                sc +
                '" data-testid="ship-card-' +
                sc +
                '" aria-pressed="' +
                (this.selectedShipClass === sc ? 'true' : 'false') +
                '" style="border: 2px solid ' +
                (this.selectedShipClass === sc ? '#00ffcc' : '#333') +
                '; background: ' +
                (this.selectedShipClass === sc
                  ? 'rgba(0,255,204,0.1)'
                  : 'transparent') +
                '; padding: 10px; border-radius: 8px; cursor: pointer; text-align: center; font-family: inherit; box-sizing: border-box;">' +
                this.getShipSVG(sc) +
                '<div style="font-size: 10px; margin-top: 5px;">' +
                sc.toUpperCase() +
                '</div>' +
                '</button>',
            )
            .join('') +
          '</div>' +
          '<div style="width: 80%; max-width: 300px;">' +
          '<div style="display: flex; justify-content: space-between; font-size: 12px; color: #888;"><span>SHIELDS</span><span>SPEED</span></div>' +
          '<input type="range" id="p1-stat-slider" data-testid="stat-focus-slider" aria-label="Pilot 1 tuning: shields versus speed" aria-describedby="p1-tuning-label" min="-5" max="5" value="' +
          this.statFocus +
          '" style="width: 100%; margin: 10px 0;">' +
          '<div id="p1-tuning-label" data-testid="stat-focus-label" style="text-align: center; color: #00ffcc; font-weight: bold;">' +
          (this.statFocus === 0
            ? 'BALANCED'
            : this.statFocus > 0
              ? 'SPEED +' + Math.round(this.statFocus * 10) + '%'
              : 'SHIELDS +' + Math.round(Math.abs(this.statFocus) * 10) + '%') +
          '</div>' +
          '</div>' +
          '</div>'
        );

      case 1: {
        // PILOT 2
        return (
          '<div class="menu-card" style="' +
          cardStyle +
          '">' +
          '<h2 style="color: #ffaa00; margin-bottom: 20px; font-size: 20px;">PILOT 2 CONFIG</h2>' +
          '<div style="font-size: 24px; font-weight: bold; margin-bottom: 10px; color: #888;">PILOT 2</div>' +
          '<div role="group" aria-label="Pilot 2 ship class" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">' +
          [ShipClass.Interceptor, ShipClass.Standard, ShipClass.Dreadnought]
            .map(
              (sc) =>
                '<button type="button" class="p2-ship-card ' +
                (this.p2SelectedShipClass === sc ? 'active' : '') +
                '" data-class="' +
                sc +
                '" data-testid="p2-ship-card-' +
                sc +
                '" aria-pressed="' +
                (this.p2SelectedShipClass === sc ? 'true' : 'false') +
                '" style="border: 2px solid ' +
                (this.p2SelectedShipClass === sc ? '#ffaa00' : '#333') +
                '; background: ' +
                (this.p2SelectedShipClass === sc
                  ? 'rgba(255,170,0,0.1)'
                  : 'transparent') +
                '; padding: 10px; border-radius: 8px; cursor: pointer; text-align: center; font-family: inherit; box-sizing: border-box;">' +
                this.getShipSVG(sc, '#ffaa00') +
                '<div style="font-size: 10px; margin-top: 5px;">' +
                sc.toUpperCase() +
                '</div>' +
                '</button>',
            )
            .join('') +
          '</div>' +
          '<div style="width: 80%; max-width: 300px;">' +
          '<div style="display: flex; justify-content: space-between; font-size: 12px; color: #888;"><span>SHIELDS</span><span>SPEED</span></div>' +
          '<input type="range" id="p2-stat-slider" data-testid="p2-stat-focus-slider" aria-label="Pilot 2 tuning: shields versus speed" aria-describedby="p2-tuning-label" min="-5" max="5" value="' +
          this.p2StatFocus +
          '" style="width: 100%; margin: 10px 0;">' +
          '<div id="p2-tuning-label" data-testid="p2-stat-focus-label" style="text-align: center; color: #ffaa00; font-weight: bold;">' +
          (this.p2StatFocus === 0
            ? 'BALANCED'
            : this.p2StatFocus > 0
              ? 'SPEED +' + this.p2StatFocus * 10 + '%'
              : 'SHIELDS +' + Math.abs(this.p2StatFocus) * 10 + '%') +
          '</div>' +
          '</div>' +
          '</div>'
        );
      }

      case 2: // MATCH RULES
        return (
          '<div class="menu-card" style="' +
          cardStyle +
          '">' +
          '<h2 style="color: #ffaa00; margin-bottom: 20px; font-size: 20px;">MATCH RULES</h2>' +
          '<div style="width: 80%; max-width: 400px; display: flex; flex-direction: column; gap: 15px; text-align: left;">' +
          '<div style="display: flex; justify-content: space-between; align-items: center;">' +
          '<span style="font-size: 14px;">PRESET</span>' +
          '<select id="sel-preset" data-testid="preset-select" aria-label="Match rule preset" style="background: #111; color: #fff; border: 1px solid #444; padding: 5px; font-size: 12px;">' +
          ['zen', 'standard', 'tactical', 'duel', 'chaos', 'custom']
            .map(
              (p) =>
                '<option value="' +
                p +
                '" ' +
                (this.selectedPreset === p ? 'selected' : '') +
                '>' +
                p.toUpperCase() +
                '</option>',
            )
            .join('') +
          '</select>' +
          '</div>' +
          '<div>' +
          '<div style="display: flex; justify-content: space-between; font-size: 12px;"><span>GAME SPEED</span><span id="label-speed">' +
          Math.round(this.gameSpeed * 100) +
          '%</span></div>' +
          '<input type="range" id="slider-speed" aria-label="Game speed" aria-describedby="label-speed" min="80" max="150" value="' +
          this.gameSpeed * 100 +
          '" style="width: 100%;">' +
          '</div>' +
          '<div style="display: flex; justify-content: space-between; align-items: center;">' +
          '<span style="font-size: 14px;">MUSIC MOOD</span>' +
          '<select id="music-profile-select" data-testid="music-profile-select" aria-label="Music intensity" style="background: #111; color: #fff; border: 1px solid #444; padding: 5px; font-size: 12px;">' +
          ['calm', 'balanced', 'tense']
            .map(
              (p) =>
                '<option value="' +
                p +
                '" ' +
                (this.musicIntensityProfile === p ? 'selected' : '') +
                '>' +
                p.toUpperCase() +
                '</option>',
            )
            .join('') +
          '</select>' +
          '</div>' +
          '<div>' +
          '<div style="display: flex; justify-content: space-between; font-size: 12px;"><span>ASTEROIDS</span><span id="label-density">' +
          this.asteroidDensity +
          '</span></div>' +
          '<input type="range" id="slider-density" data-testid="density-slider" aria-label="Asteroid density" aria-describedby="label-density" min="0" max="10" value="' +
          this.asteroidDensity +
          '" style="width: 100%;">' +
          '</div>' +
          '<div style="display: flex; justify-content: space-between; font-size: 14px;">' +
          '<span>BOOSTERS</span>' +
          '<input type="checkbox" id="check-boosters" data-testid="check-boosters" aria-label="Enable boosters" ' +
          (this.boostersEnabled ? 'checked' : '') +
          '>' +
          '</div>' +
          '<div style="display: flex; justify-content: space-between; align-items: center;">' +
          '<span style="font-size: 14px;">SERIES (WINS)</span>' +
          '<select id="series-wins-select" data-testid="series-select" aria-label="Wins needed in series" style="background: #111; color: #fff; border: 1px solid #444; padding: 5px; font-size: 12px;">' +
          [1, 3, 5, 10]
            .map(
              (w) =>
                '<option value="' +
                w +
                '" ' +
                (this.requiredWins === w ? 'selected' : '') +
                '>' +
                w +
                '</option>',
            )
            .join('') +
          '</select>' +
          '</div>' +
          '<div style="display: flex; justify-content: space-between; font-size: 14px;">' +
          '<span>HAZARDS</span>' +
          '<input type="checkbox" id="check-hazards" data-testid="check-hazards" aria-label="Enable hazards" ' +
          (this.hazardsEnabled ? 'checked' : '') +
          '>' +
          '</div>' +
          '<div style="text-align: center; margin-top: 10px;">' +
          '<button id="btn-open-calibration" style="padding: 8px 15px; background: #222; color: #00ffcc; border: 1px solid #00ffcc; border-radius: 4px; cursor: pointer; font-size: 11px;">CONTROL CALIBRATION</button>' +
          '</div>' +
          '<div style="text-align: center; margin-top: 12px;">' +
          '<button id="btn-start-survival" data-testid="start-local-from-card" style="padding: 12px 40px; background: #ffcc00; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">🚀 START MISSION</button>' +
          '</div>' +
          '</div>' +
          '</div>'
        );

      case 3: // BATTLE
        return (
          '<div class="menu-card" style="' +
          cardStyle +
          '">' +
          '<h2 style="color: #00ffcc; margin-bottom: 12px; font-size: 20px;">DUEL ARENA</h2>' +
          '<div style="width: 90%; max-width: 440px; display: flex; flex-direction: column; gap: 10px; text-align: left;">' +
          // ── Public matches ───────────────────────────────────────
          '<div style="border: 1px solid #333; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.03);">' +
          '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 6px;">' +
          '<span style="font-size: 13px; color: #ffaa00; font-weight: bold;">DUEL ARENA</span>' +
          '<span style="font-size: 10px; color: #888;">Public matches</span>' +
          '</div>' +
          '<button id="btn-host-public" data-testid="host-match-btn" style="width: 100%; padding: 10px; background: #222; color: #ffaa00; border: 1px solid #ffaa00; font-size: 11px; cursor: pointer; margin-bottom: 8px;">HOST DUEL</button>' +
          // Filter buttons
          '<div style="display: flex; gap: 4px; margin-bottom: 6px;">' +
          '<button id="filter-all" class="game-filter-btn" style="flex:1;padding:4px;background:#ffaa00;color:#000;border:none;border-radius:3px;font-size:9px;font-weight:bold;cursor:pointer;">ALL</button>' +
          '<button id="filter-people" class="game-filter-btn" style="flex:1;padding:4px;background:#333;color:#888;border:none;border-radius:3px;font-size:9px;cursor:pointer;">PILOTS</button>' +
          '<button id="filter-bots" class="game-filter-btn" style="flex:1;padding:4px;background:#333;color:#888;border:none;border-radius:3px;font-size:9px;cursor:pointer;">BOTS</button>' +
          '</div>' +
          '<div id="public-games-list" data-testid="public-games-list" style="max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.5); padding: 6px; font-size: 10px; text-align: left; border-radius: 4px;">Scanning for duels...</div>' +
          '</div>' +
          // ── Wingmen (merged: no separate passcode/private duel) ───
          '<div style="border: 1px solid #6688ff; padding: 12px; border-radius: 8px; background: rgba(102,136,255,0.06);" id="friends-section">' +
          '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px;">' +
          '<span style="font-size: 12px; color: #6688ff; font-weight: bold;">👥 WINGMEN</span>' +
          '<span style="font-size: 9px; color: #666;" id="friends-online-count"></span>' +
          '</div>' +
          // Friend code + actions
          '<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;">' +
          '<span style="font-size: 10px; color: #888;">PILOT CODE:</span>' +
          '<span style="font-size: 14px; color: #6688ff; font-weight: bold; letter-spacing: 2px;" id="friend-code-value">------</span>' +
          '<button id="btn-copy-friend-code" style="background: none; border: none; color: #6688ff; cursor: pointer; font-size: 11px;" title="Copy">📋</button>' +
          '<button id="btn-qr-friend-code" style="background: none; border: none; color: #6688ff; cursor: pointer; font-size: 11px;" title="Show QR">📱</button>' +
          '<button id="btn-share-friend-code" style="background: none; border: none; color: #6688ff; cursor: pointer; font-size: 11px;" title="Share">📤</button>' +
          '</div>' +
          '<canvas id="friend-qr-canvas" style="display: none; margin: 4px auto; border: 1px solid #444; border-radius: 4px; width: 100px; height: 100px;"></canvas>' +
          // Add wingman by code
          '<div style="display: flex; gap: 6px; margin-bottom: 8px;">' +
          '<input id="add-friend-input" aria-label="Friend code" placeholder="Enter 6-digit friend code" maxlength="6" style="flex: 1; min-width: 0; padding: 8px; background: #111; color: #6688ff; border: 1px solid #6688ff; border-radius: 4px; font-size: 14px; text-align: center; letter-spacing: 3px;">' +
          '<button id="btn-add-friend" data-testid="add-friend-btn" style="padding: 8px 14px; background: #6688ff; color: #fff; border: none; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">ADD</button>' +
          '</div>' +
          '<div id="friends-list" style="max-height: 110px; overflow-y: auto; font-size: 10px; text-align: left; min-height: 24px;"></div>' +
          '</div>' +
          '<button id="btn-show-leaderboard" data-testid="leaderboard-btn" style="margin-top: 8px; padding: 8px 14px; background: #111; color: #ffcc00; border: 1px solid #ffcc00; border-radius: 4px; cursor: pointer; font-size: 11px; width: 100%; max-width: 400px;">🏆 LEADERBOARD</button>' +
          '<a id="btn-support-arena" data-testid="support-arena-btn" href="https://github.com/sponsors/mark-e-deyoung" target="_blank" rel="noopener" style="display: block; margin-top: 6px; padding: 8px 14px; background: #111; color: #ff6688; border: 1px solid #ff6688; border-radius: 4px; cursor: pointer; font-size: 10px; text-align: center; text-decoration: none; width: 100%; max-width: 400px; box-sizing: border-box;">♥ SUPPORT THE ARENA</a>' +
          '<p style="margin-top: 14px; font-size: 10px; color: #444;">v' +
          this.version +
          ' • Vectorized Duel Space Combat</p>' +
          '</div>'
        );

      default:
        return '';
    }
  }

  public renderInitialMenu() {
    this.clearStatusAnimation();
    this.saveSettings();
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const cards = isMobile ? [0, 2, 3] : [0, 1, 2, 3];

    this.container.innerHTML =
      '<h1 data-testid="game-title" style="position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); left: 0; width: 100%; margin: 0; color: #00ffcc; font-size: 24px; line-height: 32px; text-align: center; pointer-events: none; z-index: 1300; text-shadow: 0 0 12px #00ffcc, 0 2px 0 #000;">OPEN SPACE DUEL</h1>' +
      '<div id="carousel-container" style="width: 100%; height: 100%; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scroll-behavior: smooth;">' +
      cards.map((i) => this.renderCard(i)).join('') +
      '</div>' +
      // NAV BUTTONS
      '<button id="nav-prev" style="position: absolute; left: calc(10px + env(safe-area-inset-left, 0px)); top: 40%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #fff; width: 44px; height: 44px; border-radius: 22px; cursor: pointer; font-size: 18px; z-index: 1100;">&lt;</button>' +
      '<button id="nav-next" style="position: absolute; right: calc(10px + env(safe-area-inset-right, 0px)); top: 40%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #fff; width: 44px; height: 44px; border-radius: 22px; cursor: pointer; font-size: 18px; z-index: 1100;">&gt;</button>' +
      // QUICK LAUNCH BAR
      '<div style="position: absolute; bottom: 0; left: 0; width: 100%; background: rgba(20,20,20,0.9); border-top: 1px solid #333; padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px)) 10px; box-sizing: border-box; display: flex; gap: 10px; justify-content: center; z-index: 1200;">' +
      '<button id="btn-local-solo" data-testid="start-local-btn" style="flex: 1; max-width: 150px; min-height: 44px; box-sizing: border-box; padding: 12px; background: #00ffcc; color: #000; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">SURVIVAL</button>' +
      (!isMobile && this.localMultiplayerPossible
        ? '<button id="btn-local-duel" data-testid="start-local-multi-btn" style="flex: 1; max-width: 150px; min-height: 44px; box-sizing: border-box; padding: 12px; background: #ffaa00; color: #000; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">LOCAL DUEL</button>'
        : '') +
      '<button id="btn-quick-host" data-testid="open-host-card-btn" style="flex: 1; max-width: 150px; min-height: 44px; box-sizing: border-box; padding: 12px; background: #222; color: #ffaa00; border: 1px solid #ffaa00; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">DUEL</button>' +
      '</div>' +
      // INDICATORS
      '<div style="position: absolute; bottom: calc(65px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 1100;">' +
      cards
        .map(
          (_, i) =>
            '<div class="nav-dot" data-index="' +
            i +
            '" style="width: 8px; height: 8px; border-radius: 4px; background: ' +
            (this.currentCardIndex === i ? '#00ffcc' : '#444') +
            ';"></div>',
        )
        .join('') +
      '</div>' +
      // Sound toggle — rendered externally as position:fixed to avoid Safari scroll-snap issues
      '';

    const carousel = this.container.querySelector(
      '#carousel-container',
    ) as HTMLDivElement;

    carousel.onscroll = () => {
      const idx = Math.round(carousel.scrollLeft / carousel.offsetWidth);
      if (idx !== this.currentCardIndex) {
        this.currentCardIndex = idx;
        const dots = this.container.querySelectorAll('.nav-dot');
        dots.forEach((dot, i) => {
          (dot as HTMLElement).style.background =
            i === this.currentCardIndex ? '#00ffcc' : '#444';
        });
      }
    };

    const btnPrev = this.container.querySelector(
      '#nav-prev',
    ) as HTMLButtonElement;
    const btnNext = this.container.querySelector(
      '#nav-next',
    ) as HTMLButtonElement;
    btnPrev.onclick = () =>
      carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
    btnNext.onclick = () =>
      carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });

    const regenClick = () => {
      if (this.onRegenerateCallSign) {
        this.callSign = this.onRegenerateCallSign();
        this.renderInitialMenu();
      }
    };
    this.container
      .querySelectorAll('#btn-regen-name, #btn-regen-name-inline')
      .forEach((btn) => {
        (btn as HTMLButtonElement).onclick = regenClick;
      });

    const btnSound = this.container.querySelector(
      '#btn-global-sound',
    ) as HTMLButtonElement;
    if (btnSound)
      btnSound.onclick = () => {
        this.soundEnabled = !this.soundEnabled;
        btnSound.innerText = this.soundEnabled ? '🔊' : '🔇';
        if (this.onSoundToggle) this.onSoundToggle(this.soundEnabled);
      };

    // Card P1
    this.container.querySelectorAll('.p1-ship-card').forEach((card) => {
      (card as HTMLElement).onclick = () => {
        const selected = card.getAttribute('data-class') as ShipClass;
        this.selectedShipClass = selected;
        this.saveSettings();
        this.renderInitialMenu();
        this.container.querySelector<HTMLButtonElement>(`[data-testid="ship-card-${selected}"]`)?.focus();
      };
    });
    const p1Slider = this.container.querySelector(
      '#p1-stat-slider',
    ) as HTMLInputElement;
    if (p1Slider) {
      p1Slider.oninput = () => {
        this.statFocus = parseInt(p1Slider.value, 10);
        const label = this.container.querySelector(
          '#p1-tuning-label',
        ) as HTMLDivElement;
        if (label)
          label.innerText =
            this.statFocus === 0
              ? 'BALANCED'
              : this.statFocus > 0
                ? 'SPEED +' + Math.round(this.statFocus * 10) + '%'
                : 'SHIELDS +' + Math.round(Math.abs(this.statFocus) * 10) + '%';
      };
      p1Slider.onchange = () => this.saveSettings();
    }

    // Card P2
    this.container.querySelectorAll('.p2-ship-card').forEach((card) => {
      (card as HTMLElement).onclick = () => {
        const selected = card.getAttribute('data-class') as ShipClass;
        this.p2SelectedShipClass = selected;
        this.saveSettings();
        this.renderInitialMenu();
        this.container.querySelector<HTMLButtonElement>(`[data-testid="p2-ship-card-${selected}"]`)?.focus();
      };
    });
    const p2Slider = this.container.querySelector(
      '#p2-stat-slider',
    ) as HTMLInputElement;
    if (p2Slider) {
      p2Slider.oninput = () => {
        this.p2StatFocus = parseInt(p2Slider.value, 10);
        const label = this.container.querySelector(
          '#p2-tuning-label',
        ) as HTMLDivElement;
        if (label)
          label.innerText =
            this.p2StatFocus === 0
              ? 'BALANCED'
              : this.p2StatFocus > 0
                ? 'SPEED +' + this.p2StatFocus * 10 + '%'
                : 'SHIELDS +' + Math.abs(this.p2StatFocus) * 10 + '%';
      };
      p2Slider.onchange = () => this.saveSettings();
    }

    // Rules
    const selP = this.container.querySelector(
      '#sel-preset',
    ) as HTMLSelectElement;
    if (selP)
      selP.onchange = () => {
        this.selectedPreset = selP.value;
        this.applyPreset(this.selectedPreset);
        this.saveSettings();
        this.renderInitialMenu();
      };
    const slS = this.container.querySelector(
      '#slider-speed',
    ) as HTMLInputElement;
    if (slS)
      slS.onchange = () => {
        this.gameSpeed = parseInt(slS.value, 10) / 100;
        this.selectedPreset = 'custom';
        this.saveSettings();
        this.renderInitialMenu();
      };
    const selM = this.container.querySelector(
      '#music-profile-select',
    ) as HTMLSelectElement;
    if (selM)
      selM.onchange = () => {
        this.musicIntensityProfile = selM.value as
          | 'calm'
          | 'balanced'
          | 'tense';
        this.saveSettings();
        if (this.onMusicIntensityProfileChange) {
          this.onMusicIntensityProfileChange(this.musicIntensityProfile);
        }
        this.renderInitialMenu();
      };
    const slD = this.container.querySelector(
      '#slider-density',
    ) as HTMLInputElement;
    if (slD)
      slD.onchange = () => {
        this.asteroidDensity = parseInt(slD.value, 10);
        this.selectedPreset = 'custom';
        this.saveSettings();
        this.renderInitialMenu();
      };
    const chB = this.container.querySelector(
      '#check-boosters',
    ) as HTMLInputElement;
    if (chB)
      chB.onchange = () => {
        this.boostersEnabled = chB.checked;
        this.selectedPreset = 'custom';
        this.saveSettings();
      };
    const chH = this.container.querySelector(
      '#check-hazards',
    ) as HTMLInputElement;
    if (chH)
      chH.onchange = () => {
        this.hazardsEnabled = chH.checked;
        this.selectedPreset = 'custom';
        this.saveSettings();
      };

    const selH = this.container.querySelector(
      '#series-wins-select',
    ) as HTMLSelectElement;
    if (selH)
      selH.onchange = () => {
        this.requiredWins = parseInt(selH.value, 10);
        this.saveSettings();
        this.renderInitialMenu();
      };

    const btnCalib = this.container.querySelector(
      '#btn-open-calibration',
    ) as HTMLButtonElement;
    if (btnCalib) btnCalib.onclick = () => this.renderGamepadCalibration();

    const btnStartCard = this.container.querySelector(
      '#btn-start-survival',
    ) as HTMLButtonElement;
    if (btnStartCard)
      btnStartCard.onclick = () => {
        this.saveSettings();
        this.onStartLocal?.(this.selectedShipClass, 1);
      };

    // Battle / Launch
    const btnSolo = this.container.querySelector(
      '#btn-local-solo',
    ) as HTMLButtonElement;
    if (btnSolo)
      btnSolo.onclick = () => {
        // First click: navigate to PILOT 1 card. Second click: start the game.
        if (this.currentCardIndex !== 0) {
          carousel.scrollLeft = 0;
          this.currentCardIndex = 0;
          btnSolo.textContent = '▸ LAUNCH';
          btnSolo.style.background = '#ffcc00';
          setTimeout(() => {
            btnSolo.textContent = 'SURVIVAL';
            btnSolo.style.background = '#00ffcc';
          }, 5000);
          return;
        }
        this.saveSettings();
        this.onStartLocal?.(this.selectedShipClass, 1);
      };

    const btnDuel = this.container.querySelector(
      '#btn-local-duel',
    ) as HTMLButtonElement;
    if (btnDuel)
      btnDuel.onclick = () => {
        this.saveSettings();
        this.onStartLocalMultiplayer?.(
          this.selectedShipClass,
          this.statFocus,
          this.p2SelectedShipClass,
          this.p2StatFocus,
          1,
        );
      };

    const btnQuickHost = this.container.querySelector(
      '#btn-quick-host',
    ) as HTMLButtonElement;
    if (btnQuickHost)
      btnQuickHost.onclick = () => {
        carousel.scrollTo({
          left: carousel.offsetWidth * (cards.length - 1),
          behavior: 'smooth',
        });
      };

    const btnHostPub = this.container.querySelector(
      '#btn-host-public',
    ) as HTMLButtonElement;
    if (btnHostPub)
      btnHostPub.onclick = () =>
        this.onHostGame?.('nostr', this.selectedShipClass, 1);

    const btnHostPriv = this.container.querySelector(
      '#btn-host-private',
    ) as HTMLButtonElement;
    if (btnHostPriv)
      btnHostPriv.onclick = () =>
        this.onHostGame?.('manual', this.selectedShipClass, 1);

    const btnJoinManual = this.container.querySelector(
      '#btn-join-manual',
    ) as HTMLButtonElement;
    if (btnJoinManual)
      btnJoinManual.onclick = () => {
        const input = this.container.querySelector(
          '#manual-invite-input',
        ) as HTMLInputElement;
        if (input?.value) this.onJoinGame?.(input.value);
      };

    const btnLeaderboard = this.container.querySelector(
      '#btn-show-leaderboard',
    ) as HTMLButtonElement;
    if (btnLeaderboard)
      btnLeaderboard.onclick = () => this.onShowLeaderboard?.();

    // ── Passcode handlers ──────────────────────────────────────────
    const btnJoinPasscode = this.container.querySelector(
      '#btn-join-passcode',
    ) as HTMLButtonElement;
    const passcodeInput = this.container.querySelector(
      '#passcode-input',
    ) as HTMLInputElement;
    const passcodeStatus = this.container.querySelector(
      '#passcode-status',
    ) as HTMLElement;
    if (btnJoinPasscode && passcodeInput) {
      btnJoinPasscode.onclick = async () => {
        const code = passcodeInput.value.trim().toUpperCase();
        if (!code || !this.onResolvePasscode) return;
        if (passcodeStatus) {
          passcodeStatus.textContent = 'Looking up...';
          passcodeStatus.style.color = '#ffcc00';
        }
        const result = await this.onResolvePasscode(code);
        if (result) {
          if (passcodeStatus) {
            passcodeStatus.textContent = 'Found! Joining...';
            passcodeStatus.style.color = '#00ffcc';
          }
          this.onJoinDiscoveredGame?.(
            result.roomId,
            result.strategy as 'nostr' | 'torrent',
          );
        } else {
          if (passcodeStatus) {
            passcodeStatus.textContent = 'Not found or expired';
            passcodeStatus.style.color = '#ff6688';
          }
        }
      };
    }

    // ── Copy / Share link handlers ─────────────────────────────────
    const btnCopyLink = this.container.querySelector(
      '#btn-copy-link',
    ) as HTMLButtonElement;
    const btnShareLink = this.container.querySelector(
      '#btn-share-link',
    ) as HTMLButtonElement;
    if (btnCopyLink)
      btnCopyLink.onclick = () => {
        const textarea = this.container.querySelector(
          '#duel-link-text',
        ) as HTMLTextAreaElement;
        if (textarea?.value && this.onCopyDuelLink)
          this.onCopyDuelLink(textarea.value);
      };
    if (btnShareLink)
      btnShareLink.onclick = () => {
        const textarea = this.container.querySelector(
          '#duel-link-text',
        ) as HTMLTextAreaElement;
        if (textarea?.value && this.onShareDuelLink)
          this.onShareDuelLink(textarea.value);
      };

    // ── Friends handlers ───────────────────────────────────────────
    const btnAddFriend = this.container.querySelector(
      '#btn-add-friend',
    ) as HTMLButtonElement;
    const addFriendInput = this.container.querySelector(
      '#add-friend-input',
    ) as HTMLInputElement;
    if (btnAddFriend && addFriendInput) {
      btnAddFriend.onclick = () => {
        const id = addFriendInput.value.trim();
        if (id && this.onAddFriend) {
          const name =
            prompt('Enter a nickname for this friend:', 'Friend')?.trim() ||
            'Friend';
          this.onAddFriend(id, name);
          addFriendInput.value = '';
        }
      };
    }
    const btnCopyFriendCode = this.container.querySelector(
      '#btn-copy-friend-code',
    ) as HTMLButtonElement;
    const friendCodeVal = this.container.querySelector(
      '#friend-code-value',
    ) as HTMLElement;
    if (btnCopyFriendCode && friendCodeVal) {
      btnCopyFriendCode.onclick = () => {
        const code = friendCodeVal.textContent || '';
        if (code && this.onCopyFriendCode) this.onCopyFriendCode(code);
      };
    }

    // Wire friend QR code toggle
    const btnQrCode = this.container.querySelector(
      '#btn-qr-friend-code',
    ) as HTMLButtonElement;
    const qrCanvas = this.container.querySelector(
      '#friend-qr-canvas',
    ) as HTMLCanvasElement;
    if (btnQrCode && qrCanvas && friendCodeVal) {
      let qrVisible = false;
      btnQrCode.onclick = () => {
        qrVisible = !qrVisible;
        qrCanvas.style.display = qrVisible ? 'block' : 'none';
        if (qrVisible) {
          const code = friendCodeVal.textContent || '';
          // Encode as deep link URL so scanning opens the game with the friend code pre-filled
          const origin =
            window.location.origin +
            window.location.pathname.replace(/\/$/, '');
          const url = `${origin}?addFriend=${encodeURIComponent(code)}`;
          this.renderQRCode(qrCanvas, url);
        }
      };
    }

    // Wire friend share button
    const btnShareCode = this.container.querySelector(
      '#btn-share-friend-code',
    ) as HTMLButtonElement;
    if (btnShareCode && friendCodeVal) {
      btnShareCode.onclick = () => {
        const code = friendCodeVal.textContent || '';
        if (code && this.onShareFriendCode) this.onShareFriendCode(code);
      };
    }

    // Sync carousel scroll
    carousel.scrollLeft = this.currentCardIndex * carousel.offsetWidth;

    // ── Deep link: auto-fill friend code from URL ──────────────────
    const params = new URLSearchParams(window.location.search);
    const addFriendCode = params.get('addFriend');
    if (addFriendCode) {
      const friendInput =
        this.container.querySelector<HTMLInputElement>('#add-friend-input');
      if (friendInput) {
        friendInput.value = addFriendCode;
        friendInput.focus();
        // Navigate to the DUEL ARENA card (index 3 on desktop, 2 on mobile)
        const targetIndex =
          this.currentCardIndex >= 3 ? this.currentCardIndex : 3;
        setTimeout(() => {
          const dots = this.container.querySelectorAll('.nav-dot');
          if (dots[targetIndex]!) (dots[targetIndex]! as HTMLElement).click();
          carousel.scrollLeft = targetIndex * carousel.offsetWidth;
          friendInput.focus();
        }, 300);
      }
    }

    // Render sound toggle as position:fixed (outside carousel) for Safari compatibility
    this.renderSoundToggle();
  }

  /** Render sound toggle as a fixed-position element outside the carousel.
   *  Safari's scroll-snap stacking context intercepts pointer events on
   *  position:absolute elements inside the carousel. Fix: place it at the
   *  document body level with position:fixed. */
  private renderSoundToggle(): void {
    // Remove any existing instance first (avoids duplicates on re-render)
    const old = document.getElementById('btn-global-sound-clone');
    if (old) old.remove();
    const btn = document.createElement('button');
    btn.id = 'btn-global-sound-clone';
    btn.setAttribute('data-testid', 'sound-toggle-btn');
    btn.textContent = this.soundEnabled ? '\u{1F50A}' : '\u{1F507}';
    btn.style.cssText =
      'position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));z-index:9999;background:#222;border:1px solid #333;color:#fff;border-radius:4px;font-size:20px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    btn.onclick = () => {
      this.soundEnabled = !this.soundEnabled;
      btn.textContent = this.soundEnabled ? '\u{1F50A}' : '\u{1F507}';
      this.saveSettings();
    };
    document.body.appendChild(btn);
  }

  public renderGamepadCalibration() {
    this.clearStatusAnimation();
    if (this.gamepadUpdateTimer) clearInterval(this.gamepadUpdateTimer);

    const handles = renderControlCalibration(this.container, () => {
      this.renderInitialMenu();
    });
    this.gamepadUpdateTimer = handles.updateTimer;
  }

  private applyPreset(key: string) {
    if (this.presets[key]!) {
      const p = this.presets[key]!;
      this.gameSpeed = p.speed;
      this.boostersEnabled = p.boosters;
      this.boosterRate = p.boosterRate;
      this.asteroidDensity = p.density;
      this.hazardsEnabled = p.hazards;
      this.screenShake = p.shake;
      this.unlimitedEnergy = false;
    }
  }

  private lastNavP1 = 0;
  private lastNavP2 = 0;
  public update(p1: any, p2: any) {
    const carousel = this.container.querySelector(
      '#carousel-container',
    ) as HTMLDivElement;
    if (!carousel) return;

    const now = Date.now();
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // 1. Navigation Between Cards (P1 Only)
    if (now - this.lastNavP1 > 300) {
      if (p1.fireSecondary) {
        carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });
        this.lastNavP1 = now;
      } else if (p1.shield) {
        carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
        this.lastNavP1 = now;
      }
    }

    // 2. Card-Specific Controls
    const currentCard = isMobile
      ? [0, 2, 3][this.currentCardIndex]
      : this.currentCardIndex;

    if (currentCard === 0) {
      // PILOT 1
      if (p1.left) this.statFocus = Math.max(-5, this.statFocus - 0.1);
      if (p1.right) this.statFocus = Math.min(5, this.statFocus + 0.1);
      if (p1.fire && now - this.lastNavP1 > 200) {
        const classes = [
          ShipClass.Interceptor,
          ShipClass.Standard,
          ShipClass.Dreadnought,
        ];
        const idx =
          (classes.indexOf(this.selectedShipClass) + 1) % classes.length;
        this.selectedShipClass = classes[idx]!;
        this.lastNavP1 = now;
        this.renderInitialMenu();
      }
    } else if (currentCard === 1) {
      // PILOT 2
      if (p2 && !isMobile && this.localMultiplayerPossible) {
        if (p2.left) this.p2StatFocus = Math.max(-5, this.p2StatFocus - 0.1);
        if (p2.right) this.p2StatFocus = Math.min(5, this.p2StatFocus + 0.1);
        if (p2.fire && now - this.lastNavP2 > 200) {
          const classes = [
            ShipClass.Interceptor,
            ShipClass.Standard,
            ShipClass.Dreadnought,
          ];
          const idx =
            (classes.indexOf(this.p2SelectedShipClass) + 1) % classes.length;
          this.p2SelectedShipClass = classes[idx]!;
          this.lastNavP2 = now;
          this.renderInitialMenu();
        }
      }
    } else if (currentCard === 2) {
      // RULES
      if (p1.left) this.gameSpeed = Math.max(0.8, this.gameSpeed - 0.01);
      if (p1.right) this.gameSpeed = Math.min(1.5, this.gameSpeed + 0.01);
      if (p1.fire && now - this.lastNavP1 > 200) {
        this.hazardsEnabled = !this.hazardsEnabled;
        this.lastNavP1 = now;
        this.renderInitialMenu();
      }
    }
  }
}
