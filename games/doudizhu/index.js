/**
 * 斗地主 — hall plugin. Lobby (solo / host / join over Wi‑Fi or Bluetooth) + table.
 */

import * as engine from './engine.js';
import { botAction } from './ai.js';
import { mountTable } from './table.js';
import { createLobby } from '../../core/net/lobby.js';
import { hallStorage } from '../../core/storage.js';
import { keepAwake, lockLandscape, unlockOrientation } from '../../core/platform.js';

const CSS_ID = 'ddz-css';

export const DDZ_DEF = {
  id: engine.GAME_ID,
  code: 'DDZ',
  seats: engine.SEATS,
  engine,
  botAction,
  fallbackAction(view) {
    if (view.phase === 'bidding') {
      if (view.bidMode === 'score' || view.bidding?.stage === 'score') return { type: 'bid', score: 0 };
      return { type: view.bidding?.stage === 'rob' ? 'norob' : 'nocall' };
    }
    const last = view.trick?.last;
    if (last && last.seat !== view.seat) return { type: 'pass' };
    return { type: 'play', cards: [view.hand[view.hand.length - 1]] };
  },
  botDelay(view) {
    if (view.phase === 'bidding') return 700 + Math.random() * 600;
    return 650 + Math.random() * 700;
  },
  botProfiles: [
    { name: '阿花', avatar: '👩' },
    { name: '大强', avatar: '🧔' },
    { name: '老王', avatar: '👴' },
    { name: '小美', avatar: '👧' },
  ],
};

const SETTINGS_SCHEMA = [
  { key: 'bidMode', label: '叫地主方式', options: [{ value: 'rob', label: '抢地主' }, { value: 'score', label: '叫分' }] },
  { key: 'botLevel', label: '电脑水平', options: [{ value: 'easy', label: '简单' }, { value: 'normal', label: '普通' }, { value: 'hard', label: '困难' }] },
];

function describeSettings(s) {
  return `${s.bidMode === 'score' ? '叫分' : '抢地主'} · 电脑${{ easy: '简单', normal: '普通', hard: '困难' }[s.botLevel] || '普通'}`;
}

export default {
  mount(container, ctx) {
    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = './games/doudizhu/ddz.css?v=8';
      document.head.appendChild(link);
    }
    ctx.setThemeColor('#145233');
    lockLandscape();

    container.innerHTML = '<div class="ddz-root"></div>';
    const root = container.querySelector('.ddz-root');
    let table = null;

    const lobby = createLobby(root, {
      def: DDZ_DEF,
      title: '斗地主',
      subtitle: '经典欢乐玩法 · 抢地主 · 炸弹翻倍 · 春天',
      emoji: '🃏',
      theme: { bg: 'radial-gradient(ellipse at 50% 30%, #2f8f5b 0%, #1a6440 55%, #0e3f26 100%)', accent: '#FFB547', accentText: '#3b2400' },
      settingsSchema: SETTINGS_SCHEMA,
      defaultSettings: engine.defaultSettings(),
      describeSettings,
      storage: ctx.storage,
      playerStore: hallStorage,
      toast: ctx.toast,
      audio: ctx.audio,
      goHome: ctx.goHome,
      onEnterTable(session) {
        if (!session.solo) keepAwake(true);
        table = mountTable(root, session, {
          audio: ctx.audio,
          toast: ctx.toast,
          storage: ctx.storage,
          onExit() {
            table = null;
            keepAwake(false);
            lobby.show();
          },
        });
      },
    });

    return {
      onBack() {
        if (table) {
          table.back();
          return true;
        }
        return false;
      },
      unmount() {
        table?.destroy();
        table = null;
        lobby.destroy();
        keepAwake(false);
        unlockOrientation();
        document.getElementById(CSS_ID)?.remove();
      },
    };
  },
};
