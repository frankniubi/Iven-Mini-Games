/**
 * 斗地主 sound effects (synthesised with Web Audio through the hall's shared, unlocked context)
 * and voice call-outs through speechSynthesis when a Chinese voice is available.
 */

import { rankSpoken } from './cards.js';

export function createSfx(sharedAudio, prefs) {
  let voice = null;
  const pickVoice = () => {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    voice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
  };
  if (typeof speechSynthesis !== 'undefined') {
    pickVoice();
    speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  }

  const ctx = () => sharedAudio.getContext();

  function tone(freq, dur, { type = 'sine', vol = 0.12, to = null, delay = 0 } = {}) {
    const c = ctx();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, { vol = 0.2, from = 3000, to = 400, delay = 0, q = 0.8 } = {}) {
    const c = ctx();
    if (!c) return;
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
  }

  function say(text) {
    if (!prefs.voice || !text || typeof speechSynthesis === 'undefined' || sharedAudio.isMuted()) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (voice) u.voice = voice;
      u.rate = 1.12;
      u.pitch = 1.08;
      u.volume = 0.95;
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      // speech is optional
    }
  }

  return {
    say,
    select: () => tone(1250, 0.04, { type: 'triangle', vol: 0.05 }),
    play: () => noise(0.16, { vol: 0.22, from: 4200, to: 900, q: 0.6 }),
    pass: () => tone(330, 0.12, { type: 'sine', vol: 0.06, to: 250 }),
    turn: () => {
      tone(880, 0.12, { vol: 0.08 });
      tone(1320, 0.18, { vol: 0.07, delay: 0.1 });
    },
    deal: () => {
      for (let i = 0; i < 8; i++) noise(0.05, { vol: 0.08, from: 5000, to: 2500, delay: i * 0.07, q: 1.5 });
    },
    bid: () => tone(660, 0.1, { type: 'triangle', vol: 0.08, to: 990 }),
    bomb: () => {
      noise(0.9, { vol: 0.5, from: 1200, to: 60, q: 0.4 });
      tone(90, 0.8, { type: 'sine', vol: 0.4, to: 35 });
    },
    rocket: () => {
      noise(0.5, { vol: 0.25, from: 600, to: 6000, q: 0.5 });
      noise(0.9, { vol: 0.5, from: 1200, to: 60, q: 0.4, delay: 0.45 });
      tone(80, 0.8, { vol: 0.4, to: 30, delay: 0.45 });
    },
    whoosh: () => noise(0.45, { vol: 0.22, from: 500, to: 5000, q: 0.5 }),
    alarm: () => {
      tone(1400, 0.09, { type: 'square', vol: 0.05 });
      tone(1400, 0.09, { type: 'square', vol: 0.05, delay: 0.16 });
    },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.11, delay: i * 0.11 })),
    lose: () => [440, 392, 330, 262].forEach((f, i) => tone(f, 0.32, { type: 'sine', vol: 0.09, delay: i * 0.14 })),
  };
}

/** What the table announces for a play (similar to the classic call-outs). */
export function playCallout(combo) {
  if (!combo) return '';
  const r = rankSpoken(combo.rank);
  switch (combo.type) {
    case 'single':
      return r;
    case 'pair':
      return `对${r}`;
    case 'trio':
      return `三个${r}`;
    case 'trio1':
      return '三带一';
    case 'trio2':
      return '三带一对';
    case 'straight':
      return '顺子';
    case 'pairStraight':
      return '连对';
    case 'plane':
    case 'plane1':
    case 'plane2':
      return '飞机';
    case 'four2':
      return '四带二';
    case 'four2pairs':
      return '四带两对';
    case 'bomb':
      return '炸弹';
    case 'rocket':
      return '王炸';
    default:
      return combo.name || '';
  }
}

export const PASS_CALLOUTS = ['不要', '要不起', '过'];
