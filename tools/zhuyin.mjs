// 拼音 → 注音「首符」對照。這是題目顯示的核心：每個中文字只露出注音的第一個符號。
// 有聲母的字取聲母（我 ㄨㄛˇ 沒有聲母，所以取介音 ㄨ）。

const CONSONANTS = [
  // 先比對兩個字母的，避免 zh/ch/sh 被 z/c/s 搶先
  ['zh', 'ㄓ'], ['ch', 'ㄔ'], ['sh', 'ㄕ'],
  ['b', 'ㄅ'], ['p', 'ㄆ'], ['m', 'ㄇ'], ['f', 'ㄈ'],
  ['d', 'ㄉ'], ['t', 'ㄊ'], ['n', 'ㄋ'], ['l', 'ㄌ'],
  ['g', 'ㄍ'], ['k', 'ㄎ'], ['h', 'ㄏ'],
  ['j', 'ㄐ'], ['q', 'ㄑ'], ['x', 'ㄒ'],
  ['r', 'ㄖ'], ['z', 'ㄗ'], ['c', 'ㄘ'], ['s', 'ㄙ'],
];

// 零聲母：整個韻母的第一個符號就是首符
const RIMES = [
  ['ang', 'ㄤ'], ['eng', 'ㄥ'], ['er', 'ㄦ'],
  ['ai', 'ㄞ'], ['ei', 'ㄟ'], ['ao', 'ㄠ'], ['ou', 'ㄡ'],
  ['an', 'ㄢ'], ['en', 'ㄣ'],
  ['a', 'ㄚ'], ['o', 'ㄛ'], ['e', 'ㄜ'],
];

/** 由「無聲調拼音」推出注音首符，例如 huai → ㄏ、wo → ㄨ、yuan → ㄩ、ai → ㄞ */
export function pinyinToInitial(raw) {
  const p = String(raw).toLowerCase().replace(/[^a-zü]/g, '');
  if (!p) return null;
  for (const [pre, zh] of CONSONANTS) {
    if (p.startsWith(pre)) return zh;
  }
  if (p.startsWith('yu') || p.startsWith('ü')) return 'ㄩ'; // 月 元 雲 魚
  if (p.startsWith('y')) return 'ㄧ';                        // 一 有 要
  if (p.startsWith('w')) return 'ㄨ';                        // 我 五 忘
  for (const [pre, zh] of RIMES) {
    if (p.startsWith(pre)) return zh;
  }
  return null;
}

export const ZHUYIN_INITIALS = [
  'ㄅ','ㄆ','ㄇ','ㄈ','ㄉ','ㄊ','ㄋ','ㄌ','ㄍ','ㄎ','ㄏ',
  'ㄐ','ㄑ','ㄒ','ㄓ','ㄔ','ㄕ','ㄖ','ㄗ','ㄘ','ㄙ',
  'ㄧ','ㄨ','ㄩ','ㄚ','ㄛ','ㄜ','ㄞ','ㄟ','ㄠ','ㄡ','ㄢ','ㄣ','ㄤ','ㄥ','ㄦ',
];

export const isHan = (ch) => /\p{Script=Han}/u.test(ch);
