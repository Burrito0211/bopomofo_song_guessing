// 把 data/songs.ja.json 編譯成 data/questions.ja.json（日文題庫）。
// 用法：npm run build:ja
//
// 為什麼日文不能像中文那樣自動轉換：
//   1. 日文沒有空格，要先斷詞才知道「一個單位」是什麼；自動斷詞得帶一本
//      好幾 MB 的辭典（kuromoji），這個網站沒有 build step，扛不動。
//   2. 漢字讀音比中文多音字更難猜：生＝せい／しょう／なま／い／う…，
//      沒有上下文分析根本選不對。
// 所以來源檔要求人工提供斷詞與讀音，程式只負責取每個詞的第一個假名。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'songs.ja.json');
const OUT = join(ROOT, 'data', 'questions.ja.json');
const OUT_JS = join(ROOT, 'data', 'questions.ja.js');

const warnings = [];

/** 小寫假名（拗音・促音）在句首當「首音」時，習慣上會還原成大的 */
const SMALL_TO_LARGE = {
  ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お',
  ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ', ゎ: 'わ',
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ',
  ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ッ: 'ツ', ヮ: 'ワ',
};

const isKana = (ch) => /[぀-ゟ゠-ヿ]/.test(ch);

/** 一個詞的讀音 → 顯示用的首音 */
export function firstKana(reading) {
  for (const ch of reading) {
    if (!isKana(ch)) continue;         // 跳過長音符號以外的雜訊
    if (ch === 'ー') continue;
    return SMALL_TO_LARGE[ch] ?? ch;
  }
  return null;
}

/** 斷好詞的歌詞 ＋ 斷好詞的讀音 → 磚塊 */
export function toTiles(text, kana, where) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const readings = kana.trim().split(/\s+/).filter(Boolean);

  if (words.length !== readings.length) {
    warnings.push(
      `${where}：斷詞對不上——歌詞 ${words.length} 個詞，讀音 ${readings.length} 個`
    );
  }

  const tiles = [];
  words.forEach((word, i) => {
    const reading = readings[i] ?? '';
    const t = firstKana(reading);
    if (!t) {
      warnings.push(`${where}：「${word}」的讀音「${reading}」取不出首音`);
    }
    // w 是原本的詞，揭曉與提示要用
    tiles.push({ k: 'word', t: t ?? '？', w: word });
    if (i < words.length - 1) tiles.push({ k: 'space' });
  });
  return tiles;
}

const difficultyOf = (n) => (n <= 4 ? 1 : n <= 7 ? 2 : n <= 10 ? 3 : 4);

/** 顯示與比對用的完整句子：日文本來就不寫空格 */
const joined = (text) => text.trim().split(/\s+/).filter(Boolean).join('');

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const questions = [];
const seen = new Set();

for (const song of src.songs) {
  if (seen.has(song.id)) throw new Error(`重複的歌曲 id：${song.id}`);
  seen.add(song.id);

  song.lines.forEach((line, idx) => {
    const where = `${song.title} 第 ${idx + 1} 句`;
    const tiles = toTiles(line.text, line.kana, where);
    const answer = joined(line.text);
    const units = tiles.filter((t) => t.k === 'word').length;

    const base = {
      lang: 'ja',
      songId: song.id,
      title: song.title,
      artist: song.artist,
      year: song.year ?? null,
      line: answer,
      tiles,
    };

    questions.push({
      ...base,
      id: `${song.id}:${idx}:title`,
      mode: 'title',
      answer: song.title,
      accept: [song.title, ...(song.aliases ?? [])],
      units: song.title.length,
      difficulty: difficultyOf(song.title.length),
    });

    questions.push({
      ...base,
      id: `${song.id}:${idx}:lyric`,
      mode: 'lyric',
      answer,
      accept: [answer, ...(line.accept ?? [])],
      units,
      difficulty: difficultyOf(units),
    });
  });
}

const out = {
  version: 1,
  lang: 'ja',
  generatedAt: new Date().toISOString(),
  songCount: src.songs.length,
  questions,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
writeFileSync(
  OUT_JS,
  '/* 自動產生，請勿手動編輯。改 data/songs.ja.json 後執行 npm run build:ja */\n' +
    'window.__QUESTIONS_JA__ = ' + JSON.stringify(out) + ';\n',
  'utf8'
);

console.log(`✅ 產生 ${questions.length} 題（${src.songs.length} 首歌）→ data/questions.ja.json`);
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 個提醒：`);
  for (const w of warnings) console.log('  -', w);
}
