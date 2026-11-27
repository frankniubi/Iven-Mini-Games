/**
 * Shared Web Audio manager with automatic iOS/iPadOS Safari unlock on first gesture.
 */

import { hallStorage } from './storage.js';

let audioCtx = null;
let muted = Boolean(hallStorage.get('muted', false));
const listeners = new Set();

function ensureContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Unlock AudioContext on first user interaction (required on iPhone/iPad Safari)
function unlockOnce() {
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  // Play silent 1-sample buffer to fully unlock iOS audio hardware
  if (ctx) {
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // ignore
    }
  }
}

['pointerdown', 'touchstart', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, unlockOnce, { passive: true, once: true });
});

export const sharedAudio = {
  getContext() {
    if (muted) return null;
    return ensureContext();
  },
  isMuted() {
    return muted;
  },
  setMuted(next) {
    muted = Boolean(next);
    hallStorage.set('muted', muted);
    listeners.forEach((fn) => fn(muted));
  },
  toggleMute() {
    this.setMuted(!muted);
    if (!muted) this.playClick();
    return muted;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  playClick() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.045);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  },
};
