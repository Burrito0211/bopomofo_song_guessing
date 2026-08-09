-- ─────────────────────────────────────────────────────────────
-- ㄅㄆㄇ猜歌 — Supabase schema
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次即可。
-- ─────────────────────────────────────────────────────────────

create table if not exists songs (
  id          text primary key,
  title       text not null,
  artist      text not null,
  year        int,
  aliases     text[] not null default '{}',   -- 其他可接受的歌名寫法（簡體、英文名…）
  created_at  timestamptz not null default now()
);

create table if not exists lyric_lines (
  id          bigint generated always as identity primary key,
  song_id     text not null references songs(id) on delete cascade,
  line_index  int  not null,
  text        text not null,                  -- 完整歌詞
  tiles       jsonb not null,                 -- 預先算好的注音聲母磚塊
  difficulty  int  not null default 2,
  created_at  timestamptz not null default now(),
  unique (song_id, line_index)
);

create index if not exists lyric_lines_song_idx on lyric_lines(song_id);

-- ── 只讀的公開權限 ──────────────────────────────────────────
-- 前端只用 anon key，所以務必開 RLS，只允許 select。
alter table songs        enable row level security;
alter table lyric_lines  enable row level security;

drop policy if exists "public read songs" on songs;
create policy "public read songs" on songs
  for select to anon, authenticated using (true);

drop policy if exists "public read lines" on lyric_lines;
create policy "public read lines" on lyric_lines
  for select to anon, authenticated using (true);

-- 沒有 insert/update/delete policy＝匿名使用者一律不能寫入。
-- 你自己要新增歌曲時，用 Dashboard 或 service_role key。

-- ── 之後想做排行榜再加這張 ──────────────────────────────────
-- create table if not exists scores (
--   id          bigint generated always as identity primary key,
--   player_name text not null check (char_length(player_name) between 1 and 20),
--   score       int  not null check (score >= 0),
--   mode        text not null,
--   level       text not null,
--   created_at  timestamptz not null default now()
-- );
-- alter table scores enable row level security;
-- create policy "public read scores"  on scores for select to anon using (true);
-- create policy "public write scores" on scores for insert to anon with check (score <= 100000);
