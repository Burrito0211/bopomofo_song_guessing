// 把 data/songs.source.json 轉成可以直接貼進 Supabase SQL Editor 的 seed SQL。
// 用法：node tools/export-to-supabase.mjs > supabase/seed.sql
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'questions.json'), 'utf8'));
const src = JSON.parse(readFileSync(join(ROOT, 'data', 'songs.source.json'), 'utf8'));

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const arr = (list) => `ARRAY[${list.map(q).join(',')}]::text[]`;

const out = [];
out.push('-- 自動產生：node tools/export-to-supabase.mjs');
out.push('begin;');
out.push('');

for (const song of src.songs) {
  out.push(
    `insert into songs (id, title, artist, year, aliases) values ` +
    `(${q(song.id)}, ${q(song.title)}, ${q(song.artist)}, ${song.year ?? 'null'}, ${arr(song.aliases ?? [])})` +
    ` on conflict (id) do update set title = excluded.title, artist = excluded.artist,` +
    ` year = excluded.year, aliases = excluded.aliases;`
  );
}
out.push('');

// 一句歌詞只存一次；questions.json 裡 title/lyric 兩題共用同一句
const seen = new Set();
for (const item of data.questions) {
  const key = `${item.songId}::${item.line}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const index = src.songs
    .find((s) => s.id === item.songId)
    .lines.findIndex((l) => (typeof l === 'string' ? l : l.text) === item.line);

  out.push(
    `insert into lyric_lines (song_id, line_index, text, tiles, difficulty) values ` +
    `(${q(item.songId)}, ${index}, ${q(item.line)}, ${q(JSON.stringify(item.tiles))}::jsonb, ${item.difficulty})` +
    ` on conflict (song_id, line_index) do update set text = excluded.text,` +
    ` tiles = excluded.tiles, difficulty = excluded.difficulty;`
  );
}

out.push('');
out.push('commit;');

console.log(out.join('\n'));
