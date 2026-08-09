// 把題庫裡「換個讀音就會換成另一個注音首符」的多音字全部挑出來，讓人一眼掃過去確認。
// 用法：npm run audit          只列出可疑的
//       npm run audit -- --all 連只有一種首符的多音字也列出來
//
// 為什麼需要這個：像「長大」的長讀 zhǎng（ㄓ）不是 cháng（ㄔ）、「音樂」的樂讀
// yuè（ㄩ）不是 lè（ㄌ），選錯了題目就變成無解。程式沒辦法自己判斷哪個對，
// 但可以把「有可能選錯」的位置全部找出來，剩下的用眼睛看。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { pinyinToInitial, isHan } from './zhuyin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bank = JSON.parse(readFileSync(join(ROOT, 'data', 'questions.json'), 'utf8'));
const showAll = process.argv.includes('--all');

/** 這個字所有讀音會落在哪幾個注音首符 */
const initialsCache = new Map();
function possibleInitials(ch) {
  if (!initialsCache.has(ch)) {
    const readings = pinyin(ch, { multiple: true, type: 'array', toneType: 'none' });
    const set = new Set();
    for (const r of readings) {
      const zh = pinyinToInitial(r);
      if (zh) set.add(zh);
    }
    initialsCache.set(ch, set);
  }
  return initialsCache.get(ch);
}

const rows = [];
const seenLine = new Set();

for (const q of bank.questions) {
  if (q.mode !== 'lyric' || seenLine.has(q.line)) continue;
  seenLine.add(q.line);

  const chars = [...q.line].filter(isHan);
  const tiles = q.tiles.filter((t) => t.k === 'han');

  chars.forEach((ch, i) => {
    const options = possibleInitials(ch);
    if (options.size <= 1 && !showAll) return;
    const chosen = tiles[i]?.t;
    const others = [...options].filter((o) => o !== chosen);
    if (!others.length && !showAll) return;
    rows.push({ ch, chosen, others, line: q.line, title: q.title, artist: q.artist });
  });
}

// 同一個字集中在一起，比較好一次判斷
rows.sort((a, b) => a.ch.localeCompare(b.ch, 'zh-Hant') || a.line.localeCompare(b.line, 'zh-Hant'));

let current = '';
for (const r of rows) {
  if (r.ch !== current) {
    current = r.ch;
    const all = [...possibleInitials(r.ch)].join(' / ');
    console.log(`\n【${r.ch}】可能是 ${all}`);
  }
  console.log(`  ${r.chosen}   ${r.line}   ─ ${r.artist}《${r.title}》`);
}

const chars = new Set(rows.map((r) => r.ch));
console.log(`\n共 ${rows.length} 處、${chars.size} 個字需要人工確認。`);
console.log('確認方式：讀一次那句歌詞，如果選到的首符跟你唸出來的不一樣，');
console.log('就到 data/songs.source.json 用 { "text": …, "initials": … } 手動指定。');
