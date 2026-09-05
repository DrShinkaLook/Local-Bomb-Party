/**
 * Sound effects, synthesised at runtime.
 *
 * Every cue in the game is generated from oscillators and shaped noise rather
 * than loaded from a file. Three reasons, in order of importance:
 *
 *   1. Clean-room. Nothing here is anyone else's audio; there is no sample to
 *      have come from somewhere.
 *   2. The fuse tick has to track the fuse. A recorded tick either loops at a
 *      fixed rate or needs a dozen variants; a synthesised one takes the
 *      remaining fraction as a parameter and rises continuously.
 *   3. Zero bytes of audio in the bundle.
 *
 * Mods may still supply their own files, and `SoundKit.override` swaps a cue
 * for a decoded buffer when they do.
 */

export type Cue =
  | 'tick'
  | 'accept'
  | 'reject'
  | 'explode'
  | 'eliminate'
  | 'lifeGained'
  | 'turnStart'
  | 'victory';

export class SoundKit {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly overrides = new Map<Cue, AudioBuffer>();
  private enabled = true;
  private volume = 0.7;

  /**
   * Browsers refuse to start an AudioContext before a user gesture, so
   * construction is deferred to the first cue after interaction rather than
   * attempted at load and silently failing.
   */
  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.volume;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      return context;
    } catch {
      return null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master !== null) this.master.gain.value = this.volume;
  }

  /** Replace a cue with a mod-supplied buffer. */
  override(cue: Cue, buffer: AudioBuffer): void {
    this.overrides.set(cue, buffer);
  }

  play(cue: Cue, intensity = 0): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context === null || this.master === null) return;
    if (context.state === 'suspended') void context.resume();

    const sample = this.overrides.get(cue);
    if (sample !== undefined) {
      const source = context.createBufferSource();
      source.buffer = sample;
      source.connect(this.master);
      source.start();
      return;
    }

    switch (cue) {
      case 'tick':
        // Pitch and length track the fuse: a lazy click early, an urgent one
        // as the bomb runs down.
        this.blip(context, 420 + intensity * 900, 0.045, 0.16 + intensity * 0.3, 'square');
        return;
      case 'accept':
        this.chord(context, [523.25, 659.25, 783.99], 0.16, 0.22);
        return;
      case 'reject':
        this.blip(context, 150, 0.13, 0.3, 'sawtooth', 90);
        return;
      case 'turnStart':
        this.blip(context, 880, 0.08, 0.16, 'triangle');
        return;
      case 'lifeGained':
        this.chord(context, [659.25, 830.61, 987.77, 1318.51], 0.3, 0.24);
        return;
      case 'eliminate':
        this.blip(context, 220, 0.5, 0.28, 'sine', 60);
        return;
      case 'victory':
        this.arpeggio(context, [523.25, 659.25, 783.99, 1046.5], 0.11);
        return;
      case 'explode':
        this.explosion(context);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------

  private blip(
    context: AudioContext,
    frequency: number,
    duration: number,
    gain: number,
    shape: OscillatorType,
    glideTo?: number,
  ): void {
    const osc = context.createOscillator();
    const envelope = context.createGain();
    const now = context.currentTime;

    osc.type = shape;
    osc.frequency.setValueAtTime(frequency, now);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, now + duration);

    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(envelope).connect(this.master as GainNode);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private chord(context: AudioContext, frequencies: number[], duration: number, gain: number): void {
    for (const [i, frequency] of frequencies.entries()) {
      const osc = context.createOscillator();
      const envelope = context.createGain();
      const now = context.currentTime + i * 0.012;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, now);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(gain / frequencies.length, now + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(envelope).connect(this.master as GainNode);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }
  }

  private arpeggio(context: AudioContext, frequencies: number[], step: number): void {
    for (const [i, frequency] of frequencies.entries()) {
      const osc = context.createOscillator();
      const envelope = context.createGain();
      const now = context.currentTime + i * step;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, now);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + step * 2.4);

      osc.connect(envelope).connect(this.master as GainNode);
      osc.start(now);
      osc.stop(now + step * 2.5);
    }
  }

  /** Filtered noise burst plus a sub-bass thump. */
  private explosion(context: AudioContext): void {
    const now = context.currentTime;
    const duration = 0.9;

    const frames = Math.floor(context.sampleRate * duration);
    const noiseBuffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      // Decaying white noise; the exponent shapes the tail into a rumble
      // rather than a click.
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.2);
    }

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2_200, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + duration);

    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(noiseGain).connect(this.master as GainNode);
    noise.start(now);

    const sub = context.createOscillator();
    const subGain = context.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.5);
    subGain.gain.setValueAtTime(0.5, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    sub.connect(subGain).connect(this.master as GainNode);
    sub.start(now);
    sub.stop(now + 0.65);
  }
}

export const sfx = new SoundKit();
