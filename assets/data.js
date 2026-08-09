/**
 * 題庫存取層 —— 全站唯一碰資料來源的地方。
 *
 * 現在：讀 data/questions.js（由 npm run build:questions 產生）。
 * 以後要換 Supabase，只要改這個檔案的 loadQuestions()，遊戲程式一行都不用動。
 * 換法見檔案最下面的範例。
 */

/** @typedef {{k:'han'|'latin'|'digit'|'punct'|'space', t?:string}} Tile */

(function (global) {
'use strict';

/**
 * 取得整份題庫。
 * @returns {Promise<{questions: Array, songCount: number}>}
 */
async function loadQuestions() {
  // 1) 直接用 <script src="data/questions.js"> 掛上來的資料（file:// 也能用）
  if (typeof window !== 'undefined' && window.__QUESTIONS__) {
    return normalize(window.__QUESTIONS__);
  }

  // 2) 退而求其次：從 JSON 抓（需要用 http 伺服器打開，例如 npm run dev）
  const res = await fetch('data/questions.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`題庫載入失敗（HTTP ${res.status}）`);
  return normalize(await res.json());
}

function normalize(raw) {
  const questions = Array.isArray(raw) ? raw : raw.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('題庫是空的');
  }
  return {
    questions,
    songCount: raw.songCount ?? new Set(questions.map((q) => q.songId)).size,
  };
}

global.GameData = { loadQuestions };

})(window);

/* ─────────────────────────────────────────────────────────────
   之後要換成 Supabase 的話：

   1. 在 Supabase 建兩張表（SQL 在 supabase/schema.sql）：songs、lyric_lines
   2. 用 tools/export-to-supabase.mjs 產生 seed SQL，貼進 SQL Editor 跑一次
   3. index.html 加上：
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   4. 把上面的 loadQuestions() 換成下面這段（anon key 是公開可用的，
      只要 RLS 設成唯讀就安全）：

   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...';

   export async function loadQuestions() {
     const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
     const { data, error } = await db
       .from('lyric_lines')
       .select('id, text, tiles, difficulty, songs ( id, title, artist, year, aliases )');
     if (error) throw error;

     const questions = [];
     for (const row of data) {
       const song = row.songs;
       const base = {
         songId: song.id, title: song.title, artist: song.artist,
         year: song.year, line: row.text, tiles: row.tiles,
       };
       questions.push({ ...base, id: `${row.id}:title`, mode: 'title',
         answer: song.title, accept: [song.title, ...(song.aliases ?? [])],
         difficulty: row.difficulty });
       questions.push({ ...base, id: `${row.id}:lyric`, mode: 'lyric',
         answer: row.text, accept: [row.text], difficulty: row.difficulty });
     }
     return { questions, songCount: new Set(questions.map(q => q.songId)).size };
   }
   ───────────────────────────────────────────────────────────── */
