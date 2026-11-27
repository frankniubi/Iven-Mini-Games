/**
 * Playing-card DOM for 斗地主. Cards are plain divs styled in ddz.css; size comes from the
 * --cw/--ch (hand) and --mw/--mh (played) CSS variables set by the table layout.
 */

const RANK_TEXT = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUIT_SYM = ['♠', '♥', '♣', '♦'];

export function rankLabel(rank) {
  if (rank === 13) return '小王';
  if (rank === 14) return '大王';
  return RANK_TEXT[rank];
}

/** Spoken name of a rank (for voice lines). */
export function rankSpoken(rank) {
  return ['三', '四', '五', '六', '七', '八', '九', '十', '勾', '圈', '凯', '尖', '二', '小王', '大王'][rank];
}

export function cardHtml(id, extraClass = '') {
  if (id === 52 || id === 53) {
    const big = id === 53;
    return `<div class="pk joker ${big ? 'big' : 'small'} ${extraClass}" data-id="${id}">
      <span class="pk-jk">JOKER</span><span class="pk-jc">${big ? '大王' : '小王'}</span><span class="pk-star">★</span></div>`;
  }
  const rank = Math.floor(id / 4);
  const suit = id % 4;
  const red = suit === 1 || suit === 3;
  const r = RANK_TEXT[rank];
  const face = rank >= 8 && rank <= 10;
  const center = face ? `<span class="pk-face">${r}<i>${SUIT_SYM[suit]}</i></span>` : `<span class="pk-c">${SUIT_SYM[suit]}</span>`;
  return `<div class="pk ${red ? 'red' : 'black'} ${extraClass}" data-id="${id}">
    <span class="pk-corner"><span class="pk-r${r === '10' ? ' ten' : ''}">${r}</span><span class="pk-s">${SUIT_SYM[suit]}</span></span>${center}</div>`;
}

export function backHtml(extraClass = '') {
  return `<div class="pk back ${extraClass}"><span class="pk-back-inner"></span></div>`;
}

export function cardsHtml(ids, extraClass = '') {
  return ids.map((id) => cardHtml(id, extraClass)).join('');
}
