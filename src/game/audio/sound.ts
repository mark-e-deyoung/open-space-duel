export type SoundType =
  | 'thrust'
  | 'fire'
  | 'shield'
  | 'depleted'
  | 'explosion'
  | 'hit'
  | 'explosionDramatic'
  | 'respawn'
  | 'emp'
  | 'snakeMove'
  | 'saucerMove'
  | 'tauntAggressive'
  | 'tauntCheerful'
  | 'tauntStartled';

export type UISoundType = 'hover' | 'click';

export class SoundEngine {
  private ctx: AudioContext;
  private activeOscillators = 0;
  private readonly SOFT_LIMIT = 16;
  private readonly HARD_LIMIT = 24;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  private createVoice(isHighPriority: boolean = false): {
    osc: OscillatorNode;
    gain: GainNode;
  } | null {
    if (
      this.activeOscillators >=
      (isHighPriority ? this.HARD_LIMIT : this.SOFT_LIMIT)
    ) {
      return null;
    }

    this.activeOscillators++;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.onended = () => {
      this.activeOscillators--;
      gain.disconnect();
    };

    return { osc, gain };
  }

  public playUISound(type: UISoundType) {
    const voice = this.createVoice(false);
    if (!voice) return;

    const { osc, gain } = voice;
    const now = this.ctx.currentTime;
    let duration = 0.05;

    if (type === 'hover') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      duration = 0.1;
    }

    osc.start();
    osc.stop(now + duration);
  }

  public playSound(type: SoundType) {
    const isHighPriority =
      type === 'explosion' ||
      type === 'hit' ||
      type === 'explosionDramatic' ||
      type === 'emp';

    const voice = this.createVoice(isHighPriority);
    if (!voice) return;

    const { osc, gain } = voice;
    const now = this.ctx.currentTime;

    let freq = 440;
    let duration = 0.1;
    let gainVal = 0.1;

    switch (type) {
      case 'fire':
        osc.type = 'square';
        freq = 440;
        duration = 0.1;
        gainVal = 0.1;
        break;
      case 'thrust':
        osc.type = 'sawtooth';
        freq = 60;
        duration = 0.1;
        gainVal = 0.05;
        break;
      case 'shield':
        osc.type = 'sine';
        freq = 400;
        duration = 0.1;
        gainVal = 0.05;
        break;
      case 'depleted':
        osc.type = 'sine';
        freq = 150;
        duration = 0.1;
        gainVal = 0.1;
        break;
      case 'explosion':
        osc.type = 'sawtooth';
        freq = 100;
        duration = 0.4;
        gainVal = 0.2;
        break;
      case 'explosionDramatic':
        osc.type = 'sawtooth';
        freq = 60;
        duration = 1.5;
        gainVal = 0.4;
        break;
      case 'hit':
        osc.type = 'sine';
        freq = 220;
        duration = 0.1;
        gainVal = 0.1;
        break;
      case 'respawn':
        osc.type = 'sine';
        freq = 220;
        duration = 0.3;
        gainVal = 0.1;
        break;
      case 'emp':
        osc.type = 'sawtooth';
        freq = 880;
        duration = 0.5;
        gainVal = 0.2;
        break;
      case 'snakeMove':
        osc.type = 'triangle';
        freq = 100;
        duration = 0.05;
        gainVal = 0.03;
        break;
      case 'saucerMove':
        osc.type = 'sine';
        freq = 200;
        duration = 0.1;
        gainVal = 0.04;
        break;
      // ── Taunt sounds (culture-neutral, emoji-associated) ──────
      case 'tauntAggressive':
        osc.type = 'sawtooth';
        freq = 80;
        duration = 0.35;
        gainVal = 0.15;
        break;
      case 'tauntCheerful':
        osc.type = 'sine';
        freq = 523; // C5
        duration = 0.25;
        gainVal = 0.08;
        break;
      case 'tauntStartled':
        osc.type = 'triangle';
        freq = 900;
        duration = 0.12;
        gainVal = 0.1;
        break;
    }

    osc.frequency.setValueAtTime(freq, now);

    if (type === 'fire' || type === 'thrust' || type === 'shield') {
      osc.frequency.exponentialRampToValueAtTime(
        type === 'shield' ? 1760 : type === 'thrust' ? 40 : 110,
        now + duration,
      );
    } else if (type === 'explosion') {
      osc.frequency.exponentialRampToValueAtTime(10, now + duration);
    } else if (type === 'explosionDramatic') {
      osc.frequency.exponentialRampToValueAtTime(5, now + duration);
    } else if (type === 'respawn') {
      osc.frequency.exponentialRampToValueAtTime(880, now + duration);
    } else if (type === 'emp') {
      osc.frequency.exponentialRampToValueAtTime(110, now + duration);
    } else if (type === 'snakeMove') {
      // Slithering sweep
      osc.frequency.linearRampToValueAtTime(300, now + duration * 0.5);
      osc.frequency.linearRampToValueAtTime(100, now + duration);
    } else if (type === 'saucerMove') {
      osc.frequency.linearRampToValueAtTime(600, now + duration * 0.3);
      osc.frequency.linearRampToValueAtTime(200, now + duration * 0.6);
      osc.frequency.linearRampToValueAtTime(400, now + duration);
    } else if (type === 'tauntAggressive') {
      osc.frequency.exponentialRampToValueAtTime(20, now + duration);
    } else if (type === 'tauntCheerful') {
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.linearRampToValueAtTime(784, now + duration * 0.4);
      osc.frequency.linearRampToValueAtTime(659, now + duration);
    } else if (type === 'tauntStartled') {
      osc.frequency.linearRampToValueAtTime(400, now + duration);
    }

    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    try {
      osc.start();
      osc.stop(now + duration);
    } catch {
      // Ignore
    }
  }
}
