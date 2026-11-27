/**
 * 游戏大厅插件注册表 (Game Registry)
 *
 * 以后新增小游戏只需两步：
 * 1. 在 games/<你的游戏ID>/index.js 导出 default 对象，包含 mount(container, ctx) 与 unmount() 方法
 * 2. 在下方 GAMES 数组里添加一条配置对象即可自动出现在大厅！
 */

export const GAMES = [
  {
    id: 'sobosuba',
    title: 'Sobosuba 软体合成',
    shortTitle: 'Sobosuba',
    subtitle: '珠链软体物理 · 果冻互相挤成泡泡格 · 最高刷 256',
    description:
      '从顶栏挑一个果冻拖出箭头发射：轻点直接落下，用力能把果冻挤进窄缝。相同数字一碰就合成翻倍，只有合成过的粗体数字计分。两侧挡块被同时顶满就结束。',
    featured: true,
    status: 'ready',
    emoji: '🫧',
    accent: '#FF6B97',
    accentSoft: 'rgba(255, 107, 151, 0.14)',
    tags: ['珠链软体', '数字合成', '10套配色', '最高刷256'],
    statsLabel: '最高分',
    load: () => import('./sobosuba/index.js?v=8'),
  },
  {
    id: 'doudizhu',
    title: '斗地主',
    shortTitle: '斗地主',
    subtitle: '抢地主 · 炸弹翻倍 · 春天 · 同一 Wi‑Fi 或蓝牙三人联机',
    description:
      '经典欢乐斗地主玩法：叫地主/抢地主或叫分，炸弹王炸翻倍，春天反春。可以单机和电脑打，也能在 App 里通过同一 Wi‑Fi 或蓝牙和朋友开房间，人不够电脑补位。',
    featured: false,
    status: 'ready',
    emoji: '🃏',
    accent: '#F57C00',
    accentSoft: 'rgba(245, 124, 0, 0.15)',
    tags: ['三人联机', 'Wi‑Fi/蓝牙', '电脑补位', '记牌器'],
    statsLabel: '玩法',
    staticStatText: '单机 / 联机',
    load: () => import('./doudizhu/index.js?v=8'),
  },
  {
    id: 'taicang-mj',
    title: '太仓麻将',
    shortTitle: '太仓麻将',
    subtitle: '太仓本地规则 · 四人同桌 · 同一 Wi‑Fi 或蓝牙联机',
    description:
      '按太仓本地规则打的四人麻将。可以单机和三个电脑打，也能在 App 里通过同一 Wi‑Fi 或蓝牙和朋友开房间，人不够电脑补位。',
    featured: false,
    status: 'ready',
    emoji: '🀄',
    accent: '#C0392B',
    accentSoft: 'rgba(192, 57, 43, 0.14)',
    tags: ['四人联机', 'Wi‑Fi/蓝牙', '电脑补位', '太仓规则'],
    statsLabel: '玩法',
    staticStatText: '单机 / 联机',
    load: () => import('./taicang-mj/index.js?v=8'),
  },
  {
    id: 'pvz',
    title: '植物大战僵尸 · 完整版',
    shortTitle: '植物大战僵尸',
    subtitle: '完整 186 关原版内容 · 白天/黑夜/泳池/迷你/解谜/图鉴/调速',
    description:
      '完整版 HTML5 植物大战僵尸（含冒险模式全关卡、小游戏、解谜模式、植物与僵尸图鉴、自动拾取阳光与多倍速），手机与 iPad 自动等比缩放畅玩！',
    featured: false,
    status: 'ready',
    emoji: '🌻',
    accent: '#5CB85C',
    accentSoft: 'rgba(92, 184, 92, 0.16)',
    tags: ['完整186关', '原版全模式', '图鉴与调速', '触屏适配'],
    statsLabel: '版本',
    staticStatText: '完整全关卡',
    load: () => import('./pvz/index.js?v=8'),
  },
  {
    id: 'temple-run',
    title: '神庙逃亡 2 · Temple Run 2',
    shortTitle: 'Temple Run 2',
    subtitle: '完整全地图 3D WebGL 原版 · 含 iPad/iPhone MP3 音效与全赛道',
    description:
      '完整自托管无广告 3D 神庙逃亡 2（含全部森林/矿车/水道/冰雪赛道与 iOS Safari 音频），触屏滑动转弯、跳跃、滑铲极速跑酷！',
    featured: false,
    status: 'ready',
    emoji: '🏃',
    accent: '#F59E0B',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    tags: ['完整全赛道', 'iPad适配', '无广告', '3D跑酷'],
    statsLabel: '状态',
    staticStatText: '随时开跑',
    load: () => import('./temple-run/index.js?v=8'),
  },
];

export const FUTURE_SLOTS = [
  {
    id: 'slot-1',
    title: '更多小游戏扩展位',
    subtitle: '新建文件夹并在 registry.js 注册一条配置即可秒速上架',
    emoji: '🧩',
    tags: ['插件式扩展'],
  },
];
