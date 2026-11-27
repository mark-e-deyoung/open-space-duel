export enum CompositionType {
  Classic = 'classic',
  Anomaly = 'anomaly',
  Blockade = 'blockade',
  Swarm = 'swarm',
  ReturnToBase = 'returnToBase',
  MainMenu = 'mainMenu',
}

export type MusicIntensityProfile = 'calm' | 'balanced' | 'tense';

interface Composition {
  bassNotes: number[];
  arpNotes: number[];
  bassType: OscillatorType;
  arpType: OscillatorType;
}

interface MusicProfileConfig {
  bpmBase: number;
  intensityBpm: number;
  difficultyBpm: number;
  bassOpenBase: number;
  arpOpenBase: number;
  arpThreshold: number;
}

const MUSIC_PROFILES: Record<MusicIntensityProfile, MusicProfileConfig> = {
  calm: {
    bpmBase: 96,
    intensityBpm: 9,
    difficultyBpm: 0.5,
    bassOpenBase: 80,
    arpOpenBase: 420,
    arpThreshold: 0.3,
  },
  balanced: {
    bpmBase: 106,
    intensityBpm: 14,
    difficultyBpm: 0.9,
    bassOpenBase: 100,
    arpOpenBase: 500,
    arpThreshold: 0.22,
  },
  tense: {
    bpmBase: 114,
    intensityBpm: 17,
    difficultyBpm: 1.15,
    bassOpenBase: 120,
    arpOpenBase: 620,
    arpThreshold: 0.18,
  },
};

const COMPOSITIONS: Record<CompositionType, Composition> = {
  [CompositionType.Classic]: {
    bassNotes: [36, 39, 41, 43, 46, 48],
    arpNotes: [48, 51, 55, 58, 60, 63, 67, 70],
    bassType: 'sawtooth',
    arpType: 'square',
  },
  [CompositionType.Anomaly]: {
    bassNotes: [36, 43, 48, 51, 55],
    arpNotes: [60, 62, 67, 70, 72, 74],
    bassType: 'sine',
    arpType: 'sine',
  },
  [CompositionType.Blockade]: {
    bassNotes: [36, 37, 40, 42, 43],
    arpNotes: [48, 49, 52, 54, 55, 60, 61],
    bassType: 'square',
    arpType: 'sawtooth',
  },
  [CompositionType.Swarm]: {
    bassNotes: [36, 39, 42, 45, 48],
    arpNotes: [60, 63, 66, 69, 72, 75, 78],
    bassType: 'sawtooth',
    arpType: 'square',
  },
  [CompositionType.ReturnToBase]: {
    bassNotes: [36, 43, 48, 43], // Calming, steady progression
    arpNotes: [60, 67, 72, 76, 79], // Open, airy major/neutral feel
    bassType: 'sine',
    arpType: 'sine', // Purest, most muted waveform
  },
  [CompositionType.MainMenu]: {
    bassNotes: [36, 43, 48, 43], // Shares the same ambient bass progression
    arpNotes: [60, 63, 67, 72, 75], // Slightly more active notes
    bassType: 'sine',
    arpType: 'triangle', // Soft like sine, but with slight shimmer for UI focus
  },
};

export class MusicManager {
  private ctx: AudioContext;
  private isPlaying = false;
  private intensity = 0;
  private difficulty = 0;
  private intensityProfile: MusicIntensityProfile = 'balanced';
  private currentCompositionType: CompositionType = CompositionType.Classic;
  private currentComposition: Composition =
    COMPOSITIONS[CompositionType.Classic];

  private bassGain: GainNode;
  private arpGain: GainNode;

  private bassFilter: BiquadFilterNode;
  private arpFilter: BiquadFilterNode;

  private bpm = 120;
  private step = 0;
  private nextNoteTime = 0;
  private lookahead = 25.0; // ms
  private scheduleAheadTime = 0.1; // s
  private timerID: number | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.bassGain = this.ctx.createGain();
    this.arpGain = this.ctx.createGain();

    this.bassFilter = this.ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.Q.value = 1;

    this.arpFilter = this.ctx.createBiquadFilter();
    this.arpFilter.type = 'lowpass';
    this.arpFilter.Q.value = 5;

    this.bassGain.connect(this.bassFilter);
    this.arpGain.connect(this.arpFilter);

    // Master volume
    const masterGain = this.ctx.createGain();
    masterGain.gain.value = 0.15;

    this.bassFilter.connect(masterGain);
    this.arpFilter.connect(masterGain);

    masterGain.connect(this.ctx.destination);

    this.setIntensity(0);
  }

  private midiToFreq(m: number) {
    return Math.pow(2, (m - 69) / 12) * 440;
  }

  public setIntensity(val: number) {
    this.intensity = Math.max(0, Math.min(1, val));
    this.updateParameters();
  }

  public setDifficulty(val: number) {
    this.difficulty = Math.max(0, val);
    this.updateParameters();
  }

  public setComposition(type: CompositionType) {
    this.currentCompositionType = type;
    this.currentComposition = COMPOSITIONS[type]!;
  }

  public setIntensityProfile(profile: MusicIntensityProfile) {
    this.intensityProfile = profile;
    this.updateParameters();
  }

  public getDebugState() {
    return {
      isPlaying: this.isPlaying,
      composition: this.currentCompositionType,
      profile: this.intensityProfile,
      intensity: this.intensity,
      difficulty: this.difficulty,
      bpm: this.bpm,
      audioState: this.ctx.state,
    };
  }

  private updateParameters() {
    const now = this.ctx.currentTime;
    const profile = MUSIC_PROFILES[this.intensityProfile];

    // Higher intensity -> more open filter
    this.bassFilter.frequency.setTargetAtTime(
      profile.bassOpenBase + this.intensity * 720,
      now,
      0.1,
    );
    this.arpFilter.frequency.setTargetAtTime(
      profile.arpOpenBase + this.intensity * 3600,
      now,
      0.1,
    );

    // Difficulty increases resonance slightly
    this.bassFilter.Q.setTargetAtTime(1 + this.difficulty * 0.1, now, 0.1);
    this.arpFilter.Q.setTargetAtTime(5 + this.difficulty * 0.5, now, 0.1);

    // Arpeggio volume increases with intensity
    this.arpGain.gain.setTargetAtTime(this.intensity * 0.4, now, 0.1);
    this.bassGain.gain.setTargetAtTime(0.5 + this.intensity * 0.2, now, 0.1);

    // Keep the score calmer overall while still reacting to combat pressure.
    this.bpm =
      profile.bpmBase +
      this.intensity * profile.intensityBpm +
      Math.min(this.difficulty, 12) * profile.difficultyBpm;
  }

  private nextNote() {
    const secondsPerBeat = 60.0 / this.bpm;
    // 16th notes
    this.nextNoteTime += 0.25 * secondsPerBeat;
    this.step++;
    if (this.step >= 16) {
      this.step = 0;
    }
  }

  private playKick(time: number) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);

    // Kick volume scales slightly with intensity
    const kickVol = 0.3 + this.intensity * 0.2;
    gain.gain.setValueAtTime(kickVol, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);

    try {
      osc.start(time);
      osc.stop(time + 0.5);
    } catch {
      // Ignore if already stopped or not started
    }
  }

  private scheduleNote(stepNumber: number, time: number) {
    // Kick on downbeats
    if (stepNumber % 4 === 0) {
      this.playKick(time);
    }

    // Bass line
    if (stepNumber % 2 === 0) {
      const osc = this.ctx.createOscillator();
      osc.type = this.currentComposition.bassType;

      const notes = this.currentComposition.bassNotes;
      const idx = Math.floor(Math.random() * Math.min(notes.length, 3)); // Keep it mostly root notes
      const freq = this.midiToFreq(notes[idx]!);

      osc.frequency.value = freq;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(1, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

      osc.connect(gain);
      gain.connect(this.bassGain);

      try {
        osc.start(time);
        osc.stop(time + 0.2);
      } catch {
        /* ignore */
      }
    }

    // Arp line (active when intensity > 0.2)
    if (this.intensity > 0.2 && stepNumber % 1 === 0) {
      const osc = this.ctx.createOscillator();
      osc.type = this.currentComposition.arpType;

      const notes = this.currentComposition.arpNotes;
      const idx = Math.floor(Math.random() * notes.length);
      const freq = this.midiToFreq(notes[idx]!);

      osc.frequency.value = freq;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(1, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

      osc.connect(gain);
      gain.connect(this.arpGain);

      try {
        osc.start(time);
        osc.stop(time + 0.1);
      } catch {
        /* ignore */
      }
    }
  }

  private scheduler() {
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.step, this.nextNoteTime);
      this.nextNote();
    }
    this.timerID = window.setTimeout(this.scheduler.bind(this), this.lookahead);
  }

  public start() {
    if (this.isPlaying) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.isPlaying = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.scheduler();
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerID !== null) {
      window.clearTimeout(this.timerID);
      this.timerID = null;
    }
  }
}
