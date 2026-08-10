/**
 * 答案判定 —— 瀏覽器與 Worker 共用的唯一一份實作。
 *
 * 即時競賽是「第一個答對的人拿分」，判定必須由伺服器說了算，不然每個人都可以
 * 自己宣稱答對。但單人模式又要能離線判定，所以這份邏輯兩邊都要用得到：
 *   瀏覽器：<script src="assets/judge.js">，掛在 window.Judge
 *   Worker：import '../assets/judge.js'，掛在 globalThis.Judge
 * 寫成 IIFE 就是為了兩種載入方式都吃得下（也才能繼續用 file:// 打開）。
 */
(function (global) {
'use strict';

/** 比對前先洗掉標點、空白、全形、大小寫的差異 */
function normalize(str) {
  return String(str)
    .normalize('NFKC')          // 全形英數 → 半形
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
}

/** 編輯距離，用來容忍一個錯字 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * 判斷答案。回傳 'exact' | 'close' | 'wrong'。
 * 'close' 是差一個字，照樣算對，但會提醒正確寫法。
 * 六個字以下不做模糊比對，不然「晴天／晴大」也會被算對。
 */
function judge(input, acceptList) {
  const guess = normalize(input);
  if (!guess) return 'wrong';
  let best = 'wrong';
  for (const candidate of acceptList) {
    const target = normalize(candidate);
    if (!target) continue;
    if (guess === target) return 'exact';
    if (target.length >= 6 && editDistance(guess, target) <= 1) best = 'close';
  }
  return best;
}

const isCorrect = (verdict) => verdict === 'exact' || verdict === 'close';

global.Judge = { normalize, editDistance, judge, isCorrect };

})(typeof window !== 'undefined' ? window : globalThis);
