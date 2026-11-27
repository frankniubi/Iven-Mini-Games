/**
 * Mahjong tile faces drawn as SVG (cached data URIs), so tiles stay crisp at any size and need
 * no image assets. Kinds: 0–8 万, 9–17 条, 18–26 筒, 27–30 东南西北, 31 中, 32 发, 33 白(带框),
 * 34–41 春夏秋冬梅兰竹菊, 42 印字百搭, 43 大白板(不带框).
 */

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND = ['東', '南', '西', '北'];
const FLOWER = ['春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊'];
const SERIF = "'Songti SC','STSong','Noto Serif CJK SC','Source Han Serif SC','SimSun',serif";
const SANS = "'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Microsoft YaHei',sans-serif";

const RED = '#C62828';
const GREEN = '#1B7A3E';
const BLUE = '#1F3F8F';
const INK = '#1B1B2F';

function text(x, y, s, size, fill, family = SERIF, weight = 700) {
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${s}</text>`;
}

function dot(cx, cy, r, color) {
  return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="${color}" stroke-width="${r * 0.16}" stroke-dasharray="${r * 0.28} ${r * 0.18}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.26}" fill="${color}"/></g>`;
}

function stick(cx, cy, h, color) {
  const w = 8.2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3.6" fill="${color}"/>` +
    `<rect x="${x + 1.6}" y="${y + 1.5}" width="1.4" height="${h - 3}" rx="0.7" fill="rgba(255,255,255,0.45)"/>` +
    `<rect x="${x - 0.6}" y="${cy - 1}" width="${w + 1.2}" height="2" rx="1" fill="${color}" stroke="rgba(255,255,255,0.7)" stroke-width="0.6"/></g>`;
}

const DOTS = {
  1: [[30, 40, 19, RED]],
  2: [[30, 22, 11, GREEN], [30, 58, 11, BLUE]],
  3: [[15, 17, 9, BLUE], [30, 40, 9, RED], [45, 63, 9, GREEN]],
  4: [[18, 23, 10, BLUE], [42, 23, 10, GREEN], [18, 57, 10, GREEN], [42, 57, 10, BLUE]],
  5: [[16, 18, 8.5, BLUE], [44, 18, 8.5, GREEN], [30, 40, 8.5, RED], [16, 62, 8.5, GREEN], [44, 62, 8.5, BLUE]],
  6: [[19, 15, 8.3, GREEN], [41, 15, 8.3, GREEN], [19, 42, 8.3, RED], [41, 42, 8.3, RED], [19, 65, 8.3, RED], [41, 65, 8.3, RED]],
  7: [[14, 12, 7, GREEN], [30, 20, 7, GREEN], [46, 28, 7, GREEN], [19, 48, 7.3, RED], [41, 48, 7.3, RED], [19, 67, 7.3, RED], [41, 67, 7.3, RED]],
  8: [[19, 11, 7, BLUE], [41, 11, 7, BLUE], [19, 30.5, 7, BLUE], [41, 30.5, 7, BLUE], [19, 50, 7, BLUE], [41, 50, 7, BLUE], [19, 69, 7, BLUE], [41, 69, 7, BLUE]],
  9: [[14, 15, 7.6, BLUE], [30, 15, 7.6, BLUE], [46, 15, 7.6, BLUE], [14, 40, 7.6, RED], [30, 40, 7.6, RED], [46, 40, 7.6, RED], [14, 65, 7.6, GREEN], [30, 65, 7.6, GREEN], [46, 65, 7.6, GREEN]],
};

const STICKS = {
  2: [[30, 21, 26, GREEN], [30, 59, 26, GREEN]],
  3: [[30, 21, 26, GREEN], [19, 59, 26, GREEN], [41, 59, 26, GREEN]],
  4: [[19, 21, 26, GREEN], [41, 21, 26, GREEN], [19, 59, 26, GREEN], [41, 59, 26, GREEN]],
  5: [[15, 21, 26, GREEN], [45, 21, 26, GREEN], [30, 40, 26, RED], [15, 59, 26, GREEN], [45, 59, 26, GREEN]],
  6: [[15, 21, 26, GREEN], [30, 21, 26, GREEN], [45, 21, 26, GREEN], [15, 59, 26, GREEN], [30, 59, 26, GREEN], [45, 59, 26, GREEN]],
  7: [[30, 13, 18, RED], [15, 40, 20, GREEN], [30, 40, 20, GREEN], [45, 40, 20, GREEN], [15, 66, 20, GREEN], [30, 66, 20, GREEN], [45, 66, 20, GREEN]],
  8: [[12, 21, 26, GREEN], [24, 21, 26, GREEN], [36, 21, 26, GREEN], [48, 21, 26, GREEN], [12, 59, 26, GREEN], [24, 59, 26, GREEN], [36, 59, 26, GREEN], [48, 59, 26, GREEN]],
  9: [[15, 14, 20, GREEN], [30, 14, 20, RED], [45, 14, 20, GREEN], [15, 40, 20, GREEN], [30, 40, 20, RED], [45, 40, 20, GREEN], [15, 66, 20, GREEN], [30, 66, 20, RED], [45, 66, 20, GREEN]],
};

function bird() {
  // 幺鸡: a small stylised bird standing on a bamboo stalk.
  return `<g>
    <path d="M22 66 Q30 58 34 66" stroke="${GREEN}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M30 64 L30 74" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>
    <path d="M18 44 Q12 30 22 26 Q30 22 36 28 Q44 34 40 46 Q36 58 26 58 Q18 56 18 44 Z" fill="${GREEN}"/>
    <path d="M36 30 Q46 20 50 26 Q46 30 40 34 Z" fill="${RED}"/>
    <circle cx="30" cy="31" r="2.4" fill="#fff"/><circle cx="30.6" cy="31" r="1.2" fill="${INK}"/>
    <path d="M22 26 Q20 16 26 12 Q28 18 27 24 Z" fill="${RED}"/>
    <path d="M18 46 Q8 52 10 64 Q16 56 22 54 Z" fill="${BLUE}"/>
    <path d="M24 40 Q30 46 36 40" stroke="#fff" stroke-width="1.6" fill="none" opacity="0.7"/>
  </g>`;
}

function face(kind) {
  if (kind < 9) {
    return text(30, 24, NUM[kind], 26, INK) + text(30, 57, '萬', 30, RED);
  }
  if (kind < 18) {
    const n = kind - 9 + 1;
    if (n === 1) return bird();
    return STICKS[n].map(([x, y, h, c]) => stick(x, y, h, c)).join('');
  }
  if (kind < 27) {
    const n = kind - 18 + 1;
    return DOTS[n].map(([x, y, r, c]) => dot(x, y, r, c)).join('');
  }
  if (kind < 31) return text(30, 41, WIND[kind - 27], 40, INK);
  if (kind === 31) return text(30, 41, '中', 42, RED);
  if (kind === 32) return text(30, 41, '發', 40, GREEN);
  if (kind === 33) return `<rect x="13" y="15" width="34" height="50" rx="3" fill="none" stroke="${BLUE}" stroke-width="3.5"/><rect x="18" y="20" width="24" height="40" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.2"/>`;
  if (kind === 42) return `<rect x="10" y="12" width="40" height="56" rx="5" fill="#C62828" opacity="0.08"/>` + text(30, 27, '百', 26, RED) + text(30, 54, '搭', 26, RED);
  if (kind === 43) return '';
  const f = kind - 34;
  const color = f < 4 ? [GREEN, RED, '#B26A00', BLUE][f] : [RED, '#7B3FA0', GREEN, '#C58A00'][f - 4];
  return `<circle cx="30" cy="40" r="20" fill="${color}" opacity="0.1"/>` + text(30, 40, FLOWER[f], 34, color) + text(49, 12, String((f % 4) + 1), 11, RED, SANS, 800);
}

const cache = new Map();

/** data: URI of the tile face (ivory face only; thickness/back are CSS). */
export function tileSrc(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFEF8"/><stop offset="1" stop-color="#F1EBDA"/></linearGradient></defs>` +
    `<rect x="0.5" y="0.5" width="59" height="79" rx="6" fill="url(#g)"/>${face(kind)}</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(kind, uri);
  return uri;
}

/** wild: mark the tile as this hand's 财神 with a gold corner badge. */
export function tileHtml(kind, cls = '', extra = '', wild = false) {
  if (kind == null || kind < 0) return `<div class="mj-t back ${cls}" ${extra}></div>`;
  return `<div class="mj-t ${cls}${wild ? ' wild' : ''}" data-k="${kind}" ${extra}><img src="${tileSrc(kind)}" alt="" draggable="false"/>${wild ? '<i class="mj-wild">财</i>' : ''}</div>`;
}

export function backHtml(cls = '', extra = '') {
  return `<div class="mj-t back ${cls}" ${extra}></div>`;
}
