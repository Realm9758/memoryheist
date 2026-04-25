export class AudioManager {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', gainVal = 0.15) {
    try {
      const ctx = this.getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }

  playStep()    { this.tone(180,  0.04, 'square', 0.04); }
  playMove()    { this.tone(220,  0.05, 'square', 0.06); }
  playReveal()  {
    this.tone(440, 0.08, 'sine', 0.1);
    setTimeout(() => this.tone(660, 0.08, 'sine', 0.08), 60);
  }

  playTrap() {
    this.tone(80,  0.4,  'sawtooth', 0.22);
    setTimeout(() => this.tone(60, 0.5, 'sawtooth', 0.16), 80);
  }

  // Fake trap: a brief "safe" chirp
  playFakeTrap() {
    this.tone(440, 0.06, 'sine', 0.08);
    setTimeout(() => this.tone(550, 0.08, 'sine', 0.07), 60);
  }

  playWin() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.25, 'sine', 0.15), i * 100)
    );
  }

  playCountdown(n: number) {
    this.tone(n === 0 ? 880 : 440, 0.12, 'square', 0.1);
  }

  // Low-time ticking: short sharp click
  playTick() {
    this.tone(600, 0.06, 'square', 0.12);
  }
}
