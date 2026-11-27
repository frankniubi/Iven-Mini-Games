/**
 * Procedural squishy Web Audio synthesizer for Sobosuba.
 * Zero external files — crisp, tactile, cozy jelly acoustics that scale with merge tier & combos.
 */

// Pentatonic frequencies (C5 major pentatonic across 2.5 octaves) for pleasant harmonic merges
const PENTATONIC = [
  261.63, 293.66, 329.63, 392.00, 440.00,
  523.25, 587.33, 659.25, 783.99, 880.00,
  1046.50, 1174.66, 1318.51, 1567.98, 1760.00,
];

export function createSoboAudio(sharedAudio) {
  let lastBounceTime = 0;

  return {
    playSelect() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(480, now + 0.06);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    },

    playCancel() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.06);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    },

    playLaunch(power01) {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const p = Math.max(0, Math.min(1, power01));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const f0 = 190 + p * 140;
      const f1 = 420 + p * 320;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + 0.085);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.15, now + 0.14);
      gain.gain.setValueAtTime(0.07 + p * 0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    },

    playSpawn() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.055);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    },

    playBounce(intensity01) {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastBounceTime < 0.055) return;
      lastBounceTime = now;
      const inten = Math.max(0.08, Math.min(1, intensity01));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const base = 115 + Math.random() * 40;
      osc.frequency.setValueAtTime(base * 1.45, now);
      osc.frequency.exponentialRampToValueAtTime(base * 0.72, now + 0.065);
      gain.gain.setValueAtTime(0.06 * inten, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    },

    playMerge(newValue, chain = 1) {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const tier = Math.max(0, Math.round(Math.log2(Math.max(2, newValue))) - 1);
      const idx = Math.min(PENTATONIC.length - 1, tier + Math.min(4, Math.max(0, chain - 1)));
      const freq = PENTATONIC[idx];

      // 1) Squishy bubble pop body
      const pop = ctx.createOscillator();
      const popGain = ctx.createGain();
      pop.type = 'sine';
      pop.frequency.setValueAtTime(freq * 0.65, now);
      pop.frequency.exponentialRampToValueAtTime(freq * 1.18, now + 0.05);
      pop.frequency.exponentialRampToValueAtTime(freq, now + 0.14);
      popGain.gain.setValueAtTime(0.14, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      pop.connect(popGain);
      popGain.connect(ctx.destination);
      pop.start(now);
      pop.stop(now + 0.24);

      // 2) Warm kalimba/marimba shimmer harmonic
      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(freq * 1.5, now + 0.02);
      chimeGain.gain.setValueAtTime(0.065, now + 0.02);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      chime.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      chime.start(now + 0.02);
      chime.stop(now + 0.3);

      // 3) Extra sparkle for big merges (>= 128) or chains (>= 2)
      if (newValue >= 128 || chain >= 2) {
        const spark = ctx.createOscillator();
        const sparkGain = ctx.createGain();
        spark.type = 'sine';
        spark.frequency.setValueAtTime(freq * 2, now + 0.055);
        sparkGain.gain.setValueAtTime(0.055, now + 0.055);
        sparkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        spark.connect(sparkGain);
        sparkGain.connect(ctx.destination);
        spark.start(now + 0.055);
        spark.stop(now + 0.36);
      }
    },

    playAchievement() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const t = now + i * 0.065;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.28);
      });
    },

    // Harsh electric zap for the moment the domes give way.
    playZap() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * 0.45);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(2400, now);
      band.frequency.exponentialRampToValueAtTime(300, now + 0.45);
      band.Q.value = 2.5;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.32, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      noise.connect(band);
      band.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);

      const buzz = ctx.createOscillator();
      const buzzGain = ctx.createGain();
      buzz.type = 'sawtooth';
      buzz.frequency.setValueAtTime(180, now);
      buzz.frequency.exponentialRampToValueAtTime(40, now + 0.5);
      buzzGain.gain.setValueAtTime(0.12, now);
      buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      buzz.connect(buzzGain);
      buzzGain.connect(ctx.destination);
      buzz.start(now);
      buzz.stop(now + 0.52);
    },

    playGameOver() {
      const ctx = sharedAudio.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [392.0, 349.23, 293.66, 220.0];
      notes.forEach((freq, i) => {
        const t = now + i * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.34);
      });
    },
  };
}
