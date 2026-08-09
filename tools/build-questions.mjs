// 把 data/songs.source.json 編譯成 data/questions.json（前端直接吃的題庫）。
// 用法：npm run build:questions
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { pinyinToInitial, isHan } from './zhuyin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'songs.source.json');
const OUT = join(ROOT, 'data', 'questions.json');
const OUT_JS = join(ROOT, 'data', 'questions.js');

const warnings = [];

/** 一行歌詞 → 顯示用的磚塊陣列。中文字露出注音首符，其餘照規則處理。 */
function toTiles(text, songTitle) {
  const tiles = [];
  const chars = [...text];
  const pinyins = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' });

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isHan(ch)) {
      const zh = pinyinToInitial(pinyins[i] ?? '');
      if (!zh) {
        warnings.push(`無法轉換「${ch}」（${songTitle}：${text}）— 請在來源檔用 initials 手動指定`);
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

/** 手動覆寫格式：「ㄨ ㄏ ㄋ ㄉ」以空白分隔 */
function tilesFromOverride(str) {
  return str.trim().split(/\s+/).map((t) => ({ k: 'han', t }));
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
    const tiles = line.initials ? tilesFromOverride(line.initials) : toTiles(line.text, song.title);

    if (line.initials && tiles.length !== hanCount(line.text)) {
      warnings.push(`${song.title} 第 ${idx + 1} 句：手動 initials 有 ${tiles.length} 個，歌詞卻有 ${hanCount(line.text)} 個中文字`);
    }

    const base = {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      year: song.year ?? null,
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
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 個提醒：`);
  for (const w of warnings) console.log('  -', w);
}
