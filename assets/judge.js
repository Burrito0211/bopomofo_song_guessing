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

/**
 * 同音字與異體字容忍。
 *
 * 玩家是「聽過這首歌」在回想歌詞，不是在默寫課文——聽到 tā 的時候，
 * 你不知道歌詞裡寫的是他還是她；的得地、在再、那哪也一樣。這些字唸起來一樣，
 * 注音聲母當然也一樣，所以放寬不會讓題目變簡單，只是不再因為選錯字而被判死。
 *
 * 每一組的第一個字當代表，比對前全部換成代表字。兩邊都換，所以本來就對的答案
 * 一定還是對的，只會多接受一些寫法，不會少接受。
 */
const SAME_SOUND = [
  '他她牠它祂',   // tā
  '你妳',         // nǐ
  '的得地',       // de
  '在再',         // zài
  '那哪',         // nà / nǎ
  '做作',         // zuò
  '里裡裏',       // lǐ，裡裏是異體
  '台臺檯',       // tái
  '麼么',
  '啊阿呀',       // 語助詞，寫法很隨意
  '喔噢哦',
  '唸念',
  '佈布',
  '著着',
  '份分',
  '蹟跡',
  '為爲',
  '嗎嘛',
  '祕秘',
  '癡痴',
  '污汙',
  '遊游',
  '卷捲',
  '雕彫',
  '豔艷',
];

const FOLD = new Map();
for (const group of SAME_SOUND) {
  for (const ch of group) FOLD.set(ch, group[0]);
}

/** 把同音／異體字換成該組的代表字 */
function fold(str) {
  let out = '';
  for (const ch of str) out += FOLD.get(ch) ?? ch;
  return out;
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
  const guess = fold(normalize(input));
  if (!guess) return 'wrong';
  let best = 'wrong';
  for (const candidate of acceptList) {
    const target = fold(normalize(candidate));
    if (!target) continue;
    if (guess === target) return 'exact';
    if (target.length >= 6 && editDistance(guess, target) <= 1) best = 'close';
  }
  return best;
}

const isCorrect = (verdict) => verdict === 'exact' || verdict === 'close';

global.Judge = { normalize, fold, editDistance, judge, isCorrect, SAME_SOUND };

})(typeof window !== 'undefined' ? window : globalThis);
