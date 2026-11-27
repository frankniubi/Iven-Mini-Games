/**
 * 16 Sobosuba-inspired achievements.
 * Unlocking achievements triggers cute toast celebrations and tracks progress in the Hall.
 */

export const ACHIEVEMENTS = [
  { id: 'first_merge', icon: '🫧', title: '初次融合', desc: '完成第一次果冻数字合成' },
  { id: 'chain_2', icon: '⚡', title: '双连反应', desc: '一次发射触发 2 连环合成' },
  { id: 'chain_4', icon: '🔥', title: '多米诺大师', desc: '一次发射触发 4 连环及以上合成' },
  { id: 'midair', icon: '🕊️', title: '空中接力', desc: '在半空中完成一次数字合成' },
  { id: 'bar_merge', icon: '✨', title: '顶栏魔法', desc: '与停留在顶部浮栏上的果冻发生合成' },
  { id: 'gentle', icon: '🪶', title: '轻拿轻放', desc: '使用轻点落球完成一次合成' },
  { id: 'power_shot', icon: '💥', title: '大力出奇迹', desc: '用满力强射挤进去并触发合成' },
  { id: 'reach_64', icon: '🍓', title: '小有成就 64', desc: '合成出 64 号果冻' },
  { id: 'reach_256', icon: '🍑', title: '软糖进阶 256', desc: '合成出 256 号果冻' },
  { id: 'reach_512', icon: '🍊', title: '半千大球 512', desc: '合成出 512 号果冻' },
  { id: 'reach_1024', icon: '🌟', title: '千级达人 1024', desc: '合成出 1024 号果冻' },
  { id: 'reach_2048', icon: '👑', title: '传说 2048', desc: '合成出 2048 号大果冻' },
  { id: 'reach_4096', icon: '💎', title: '超凡 4096', desc: '合成出 4096 号巨型果冻' },
  { id: 'reach_8192', icon: '🏆', title: '登峰造极 8K', desc: '合成出 8192 号终极果冻' },
  { id: 'trio_128', icon: '🎯', title: '三足鼎立', desc: '场上同时拥有至少 3 个 ≥128 的果冻' },
  { id: 'score_2500', icon: '💖', title: '高分甜心', desc: '单局粗体总分达到 2500 分' },
];

export function createAchievementTracker(storage, onUnlock) {
  const unlockedSet = new Set(storage.get('achievements', []));

  function unlock(id) {
    if (unlockedSet.has(id)) return false;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return false;
    unlockedSet.add(id);
    storage.set('achievements', [...unlockedSet]);
    if (onUnlock) onUnlock(def);
    return true;
  }

  return {
    getUnlockedSet() {
      return unlockedSet;
    },
    getCount() {
      return unlockedSet.size;
    },
    getTotal() {
      return ACHIEVEMENTS.length;
    },
    onMerge(evt) {
      unlock('first_merge');
      if (evt.chain >= 2) unlock('chain_2');
      if (evt.chain >= 4) unlock('chain_4');
      if (evt.wasMidAir) unlock('midair');
      if (evt.wasOnBar) unlock('bar_merge');
      if (evt.wasGentleDrop) unlock('gentle');
      if (evt.wasHardShot) unlock('power_shot');

      if (evt.newValue >= 64) unlock('reach_64');
      if (evt.newValue >= 256) unlock('reach_256');
      if (evt.newValue >= 512) unlock('reach_512');
      if (evt.newValue >= 1024) unlock('reach_1024');
      if (evt.newValue >= 2048) unlock('reach_2048');
      if (evt.newValue >= 4096) unlock('reach_4096');
      if (evt.newValue >= 8192) unlock('reach_8192');
    },
    onStateCheck(blobs, score) {
      if (score >= 2500) unlock('score_2500');
      let bigCount = 0;
      for (let i = 0; i < blobs.length; i++) {
        if (blobs[i].value >= 128) bigCount++;
      }
      if (bigCount >= 3) unlock('trio_128');
    },
  };
}
