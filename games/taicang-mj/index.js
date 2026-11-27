/**
 * 太仓麻将 — hall plugin. Lobby (solo / host / join over Wi‑Fi or Bluetooth) + table.
 * Rules follow docs/taicang-mahjong-rules.md (online 同城游 version of the local game).
 */

import * as engine from './engine.js';
import { botAction } from './ai.js';
import { mountTable } from './table.js';
import { createLobby } from '../../core/net/lobby.js';
import { hallStorage } from '../../core/storage.js';
import { keepAwake, lockLandscape, unlockOrientation } from '../../core/platform.js';

const CSS_ID = 'mj-css';

export const MJ_DEF = {
  id: engine.GAME_ID,
  code: 'TCM',
  seats: engine.SEATS,
  engine,
  botAction,
  fallbackAction(view) {
    const opt = view.options || {};
    if (opt.discard) {
      const tile = view.drawn != null && view.drawn >= 0 ? view.drawn : view.hand[view.hand.length - 1];
      return { type: 'discard', tile };
    }
    return { type: 'pass' };
  },
  botDelay(view) {
    if (view.options && !view.options.discard) return 450 + Math.random() * 450;
    return 600 + Math.random() * 600;
  },
  botProfiles: [
    { name: '阿姨', avatar: '👵' },
    { name: '老张', avatar: '👨‍🦳' },
    { name: '小李', avatar: '🧑' },
    { name: '阿芳', avatar: '👩' },
    { name: '阿强', avatar: '🧔' },
  ],
};

const SETTINGS_SCHEMA = [
  { key: 'handsPerSession', label: '一场局数', options: [{ value: 4, label: '4 局' }, { value: 8, label: '8 局' }, { value: 16, label: '16 局' }] },
  { key: 'capHua', label: '封顶', options: [{ value: 50, label: '50 花' }, { value: 100, label: '100 花' }, { value: 200, label: '200 花' }] },
  { key: 'botLevel', label: '电脑水平', options: [{ value: 'easy', label: '简单' }, { value: 'normal', label: '普通' }, { value: 'hard', label: '困难' }] },
];

function describeSettings(s) {
  return `${s.handsPerSession || 8} 局一场 · 封顶 ${s.capHua || 100} 花 · 电脑${{ easy: '简单', normal: '普通', hard: '困难' }[s.botLevel] || '普通'}`;
}

const RULES_HTML = `
<b>牌</b>：152 张。万、条、筒、东南西北用来组牌；中、发、白、大白板、百搭和春夏秋冬梅兰竹菊共 28 张都是「花」，摸到就亮出、从杠头补一张，每张 1 花。<br>
<b>财神</b>：每局开牌翻一张，取它的下一张为财神（万能牌），比如翻 4 万则 5 万是财神，翻北则东是财神。财神不能吃碰杠，打出去别人也不能要。<br>
<b>胡牌</b>：四铺加一对，或七对。二花自摸、三花冲：没有大牌时，至少 2 花才能自摸，3 花才能吃冲。门清和大牌不受花数限制。手里有财神只能自摸。<br>
<b>吃碰杠</b>：只能吃上家；碰、杠谁的都行。允许一炮多响。放弃的碰、胡，到下次摸牌前不能再要。<br>
<b>算花</b>：总花 = 底花 1 + 花牌 + 杠花（数牌明杠 1、暗杠 2；风刻 1、风明杠 2、风暗杠 3）。门清、混一色、对对胡、七对、杠开、大吊车各翻一倍，清一色翻两倍（×4），有封顶。<br>
<b>收付</b>：自摸三家各付，吃冲由放冲的人付。抢杠由杠牌的人付三份。被同一人吃碰杠三口、这人又自摸，被吃碰的那家承包，付 5 倍。门清一个花都没有叫「无花果」，自摸三家各付封顶，吃冲付封顶的一半。<br>
<b>坐庄</b>：谁胡谁坐庄，荒庄庄家连庄，抢杠由杠牌的人坐庄。<br>
<span style="color:#9A7A4A">规则按网上的太仓麻将（同城游版）整理。线下各家习惯可能不同，比如漂、掰杠头没有做；哪里不一样告诉我们再调。</span>`;

export default {
  mount(container, ctx) {
    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = './games/taicang-mj/mj.css?v=8';
      document.head.appendChild(link);
    }
    ctx.setThemeColor('#0d4a3c');
    lockLandscape();

    container.innerHTML = '<div class="mj-root"></div>';
    const root = container.querySelector('.mj-root');
    let table = null;

    const lobby = createLobby(root, {
      def: MJ_DEF,
      title: '太仓麻将',
      subtitle: '翻财神 · 二花自摸三花冲 · 无花果 · 吃碰三口承包',
      emoji: '🀄',
      theme: { bg: 'radial-gradient(ellipse at 50% 30%, #1f7a62 0%, #135646 55%, #0a3a30 100%)', accent: '#E53935', accentText: '#fff' },
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
          rulesHtml: RULES_HTML,
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
