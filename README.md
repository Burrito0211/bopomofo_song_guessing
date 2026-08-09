# ㄅㄆㄇ猜歌 — Guess the lyrics by initial consonant

只給每個字的**注音聲母**，猜出這是哪首歌、哪句歌詞。

```
ㄊ  ㄑ  ㄙ  ㄉ  ㄧ  ㄩ     →  天青色等煙雨
```

純 HTML / CSS / JS，沒有 build step。用瀏覽器直接打開 `index.html` 就能玩。

---

## 快速開始

```bash
npm install          # 只裝一個開發用套件（pinyin-pro），網站本身不依賴它
npm run dev          # http://localhost:5173
npm test             # 跑檢查 + 整局流程煙霧測試
```

想直接玩也可以：**雙擊 `index.html`**。題庫是用一般 `<script>` 掛上去的，
所以 `file://` 也能跑，不一定要開伺服器。

---

## 專案結構

```
index.html                  介面
assets/styles.css           樣式（含深色模式）
assets/app.js               遊戲邏輯
assets/data.js              ★ 題庫存取層 — 之後要換 Supabase 只改這一個檔
data/songs.source.json      ★ 你要維護的檔案：歌名 + 歌詞
data/questions.json         自動產生的題庫
data/questions.js           同上，包成 <script> 版本（給 file:// 用）
tools/build-questions.mjs   歌詞 → 注音聲母的編譯器
tools/export-to-supabase.mjs 產生 Supabase 用的 seed SQL
supabase/schema.sql         Supabase 資料表 + RLS
```

---

## 新增歌曲

只要改 `data/songs.source.json`，注音聲母會自動算出來：

```json
{
  "id": "jay-qingtian",
  "title": "晴天",
  "artist": "周杰倫",
  "year": 2003,
  "aliases": ["晴天 (Sunny Day)"],
  "lines": ["故事的小黃花", "從那年蟬鳴的夏天"]
}
```

然後跑：

```bash
npm run build:questions
```

一首歌的每一句會產生兩題：**看歌詞猜歌名**、**給歌名猜歌詞**。

### 多音字怎麼辦

自動轉換用的是 pinyin-pro，多音字偶爾會挑錯讀音。遇到時手動指定該句的聲母：

```json
"lines": [
  { "text": "重來一次", "initials": "ㄔ ㄌ ㄧ ㄘ" }
]
```

`npm run build:questions` 會檢查你給的聲母數量跟中文字數對不對得上，不對會警告。

### 聲母規則

有聲母的字取聲母；零聲母的字取注音的**第一個符號**（跟大家寫注音文的習慣一樣）：

| 字 | 注音 | 顯示 |
|---|---|---|
| 說 | ㄕㄨㄛ | ㄕ |
| 我 | ㄨㄛˇ | ㄨ |
| 愛 | ㄞˋ | ㄞ |
| 月 | ㄩㄝˋ | ㄩ |
| 兒 | ㄦˊ | ㄦ |

---

## 遊戲設計

| 機制 | 說明 |
|---|---|
| 無盡挑戰 | 一題接一題，三顆愛心用完結束 |
| 開場送字 | 每題先直接送出一部分中文字（虛線格），其餘才是要猜的聲母；至少留兩個字要猜 |
| 猜歌名時 | 固定送出那句歌詞的開頭兩個字，讓你有線索起頭 |
| 連擊倍率 | 每答對一題 +0.15 倍，最高 ×3 |
| 時間獎勵 | 剩餘每秒 +4 分 |
| 難度 | 同時決定秒數與送字比例：悠閒 60 秒送 45% / 正常 30 秒送 30% / 刺激 15 秒送 12% |
| 提示 | 每次扣 50 分：報歌手 → 揭字數/首字 → 再揭一個字（不會重複揭已經送過的字） |
| 跳過 | 每局三次，連擊歸零但不扣愛心 |
| 錯字容忍 | 六字以上的答案，差一個字仍算對 |

輸入框有處理**注音輸入法選字中的 Enter**（`compositionstart` / `compositionend`），
選字時按 Enter 不會誤送出。

---

## 題庫要用什麼存？我的建議

短答：**現在這樣（JSON）就夠了，等你真的需要下面任何一項再上 Supabase。**

### 為什麼先用 JSON

- 題庫是**唯讀**的，全部才幾十 KB，跟著網站一起下載反而比打 API 快。
- 沒有後端、沒有 API key、沒有 CORS、沒有網路失敗要處理。
- 部署到 GitHub Pages / Netlify / Vercel 直接免費靜態託管。
- 改歌詞就是改一個 JSON 檔，用 git 管版本，改壞了 `git revert` 就好。

一兩百首歌都還在這個方案的舒適圈內。

### 什麼時候該換 Supabase

出現下面任何一項，就值得換：

1. **排行榜 / 分數紀錄** — 需要寫入，靜態檔做不到。
2. **每日一題** — 全站同一題、有人算得出來要防作弊，題目答案就不該全部塞在前端。
3. **想在網頁上新增歌曲**，不想每次都改檔案 + 重新部署。
4. **多人一起維護題庫**，需要權限控管。
5. 題庫大到**幾千題**，希望依難度／年代分頁載入。

> 注意第 2 點：現在整份題庫（含答案）都在前端，打開 devtools 就看得到答案。
> 純娛樂沒差，但要做競賽型的每日挑戰就得把答案留在伺服器端。

### 要換的話怎麼換

已經幫你準備好了，三步：

```bash
# 1. 在 Supabase SQL Editor 貼上並執行
cat supabase/schema.sql

# 2. 產生 seed SQL，一樣貼進 SQL Editor 執行
npm run export:supabase > supabase/seed.sql
```

3. 打開 `assets/data.js`，把 `loadQuestions()` 換成檔案底部註解裡的 Supabase 版本，
   並在 `index.html` 加上 supabase-js 的 CDN script。**遊戲程式完全不用動。**

資料表設計：`songs`（歌曲）+ `lyric_lines`（歌詞句，含預先算好的 `tiles`）。
把聲母存進資料庫而不是前端即時算，是為了不用在瀏覽器載一份幾百 KB 的漢字拼音表。

RLS 已經設成**匿名只能讀不能寫**，所以 anon key 放在前端是安全的。

---

## 部署

任何靜態託管都可以，不需要 build：

```bash
# GitHub Pages：把整個 repo 推上去，Settings → Pages → 選 main branch
# Netlify / Vercel：build command 留空，publish directory 填 .
```

`node_modules/` 已經在 `.gitignore`，不會被推上去。

---

## 版權

`data/songs.source.json` 裡只放各首歌的**短短一句**歌詞，作為猜謎題目使用，
著作權屬於原作者與發行公司。要公開上線前請自行確認你的使用情境。
