// 把 data/songs.source.json 編譯成 data/questions.json（前端直接吃的題庫）。
// 用法：npm run build:questions
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { pinyinToInitial, isHan } from './zhuyin.mjs';

// pinyin-pro 的詞庫是簡體的，餵繁體進去它認不出詞，只能一個字一個字猜讀音，
// 多音字就會挑錯：長大→cháng、音樂→lè、彈奏→dàn、馬車→jū、曬乾→qián。
// 所以查讀音前先轉成簡體，注音再貼回原本的繁體字。轉換是逐字的，字數不會變，
// 對得上索引；萬一哪天對不上就退回用原文查，並且留一則警告。
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'songs.source.json');
const OUT = join(ROOT, 'data', 'questions.json');
const OUT_JS = join(ROOT, 'data', 'questions.js');

const warnings = [];

/** 一行歌詞 → 顯示用的磚塊陣列。中文字露出注音首符，其餘照規則處理。 */
function toTiles(text, songTitle, { warn = true } = {}) {
  const tiles = [];
  const chars = [...text];

  const simplified = toSimplified(text);
  const aligned = [...simplified].length === chars.length;
  if (!aligned && warn) {
    warnings.push(`簡繁轉換後字數對不上（${songTitle}：${text}）— 改用原文查讀音，多音字請自行確認`);
  }
  const pinyins = pinyin(aligned ? simplified : text, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  });

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isHan(ch)) {
      const zh = pinyinToInitial(pinyins[i] ?? '');
      if (!zh) {
        if (warn) warnings.push(`無法轉換「${ch}」（${songTitle}：${text}）— 請在來源檔用 initials 手動指定`);
        tiles.push({ k: 'han', t: '？' });
      } else {
        tiles.push({ k: 'han', t: zh });
      }
    } else if (/\s/.test(ch)) {
      tiles.push({ k: 'space' });
    } else if (/[a-zA-Z]/.test(ch)) {
      // 英文只露出單字首字母，後續字母吃掉
      const prev = chars[i - 1];
      if (prev && /[a-zA-Z]/.test(prev)) continue;
      tiles.push({ k: 'latin', t: ch.toUpperCase() });
    } else if (/[0-9]/.test(ch)) {
      tiles.push({ k: 'digit', t: '#' });
    } else {
      tiles.push({ k: 'punct', t: ch });
    }
  }
  return tiles;
}

/**
 * 手動覆寫多音字。initials 是「ㄨ ㄏ ㄋ ㄉ」這種以空白分隔的聲母，只對應中文字；
 * 句子裡的空白與標點仍照歌詞原樣排版，所以覆寫不會把版面弄亂。
 */
function tilesFromOverride(text, initials, songTitle) {
  const given = initials.trim().split(/\s+/);
  const tiles = toTiles(text, songTitle, { warn: false });
  let i = 0;
  for (const tile of tiles) if (tile.k === 'han') tile.t = given[i++] ?? '？';
  return { tiles, count: given.length };
}

const hanCount = (s) => [...s].filter(isHan).length;

function difficultyOf(n) {
  if (n <= 4) return 1;
  if (n <= 7) return 2;
  if (n <= 10) return 3;
  return 4;
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const questions = [];
const seen = new Set();

for (const song of src.songs) {
  if (seen.has(song.id)) throw new Error(`重複的歌曲 id：${song.id}`);
  seen.add(song.id);

  song.lines.forEach((raw, idx) => {
    const line = typeof raw === 'string' ? { text: raw } : raw;
    const override = line.initials
      ? tilesFromOverride(line.text, line.initials, song.title)
      : null;
    const tiles = override ? override.tiles : toTiles(line.text, song.title);

    if (override && override.count !== hanCount(line.text)) {
      warnings.push(`${song.title} 第 ${idx + 1} 句：手動 initials 有 ${override.count} 個，歌詞卻有 ${hanCount(line.text)} 個中文字`);
    }

    const base = {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      year: song.year ?? null,
      // 有填就直接連到那支影片，沒填的話前端會退成 YouTube 搜尋
      youtube: song.youtube ?? null,
      line: line.text,
      tiles,
    };

    // 題型一：看歌詞聲母猜歌名
    questions.push({
      ...base,
      id: `${song.id}:${idx}:title`,
      mode: 'title',
      answer: song.title,
      accept: [song.title, ...(song.aliases ?? [])],
      difficulty: difficultyOf(hanCount(song.title)),
    });

    // 題型二：給歌名，猜整句歌詞
    questions.push({
      ...base,
      id: `${song.id}:${idx}:lyric`,
      mode: 'lyric',
      answer: line.text,
      accept: [line.text, ...(line.accept ?? [])],
      difficulty: difficultyOf(hanCount(line.text)),
    });
  });
}

const giveaways = questions.filter(
  (q) => q.mode === 'title' && q.line.includes(q.title)
);

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  songCount: src.songs.length,
  questions,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

// 同時輸出成一般 <script>，這樣直接用 file:// 打開 index.html 也能玩（fetch 會被瀏覽器擋）。
const banner = '/* 自動產生，請勿手動編輯。改 data/songs.source.json 後執行 npm run build:questions */\n';
writeFileSync(OUT_JS, banner + 'window.__QUESTIONS__ = ' + JSON.stringify(out) + ';\n', 'utf8');

console.log(`✅ 產生 ${questions.length} 題（${src.songs.length} 首歌）→ data/questions.json + data/questions.js`);

if (giveaways.length) {
  console.log(`\n💡 ${giveaways.length} 句歌詞裡直接出現歌名，猜歌名那題等於送分：`);
  for (const q of giveaways) console.log(`  - ${q.title}：${q.line}`);
  console.log('   想讓題目難一點，就幫這幾首多補幾句別段的歌詞。');
}
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 個提醒：`);
  for (const w of warnings) console.log('  -', w);
}
