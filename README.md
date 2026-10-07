# Corner X

BEYBLADE X / 陀螺比賽的簡易賽程管理與排行榜工具。免註冊、免登入，打開網站就能建立賽程或排行榜，並可各自產生「唯讀」公開分享連結。

技術棧：**Cloudflare Workers**（後端 API + 靜態網站）＋ **Cloudflare D1**（SQLite 資料庫）＋ **Hono**（路由框架）＋ 原生 HTML/CSS/JS 前端（無框架，手機優先）。

---

## 專案結構

```
corner-x/
├─ wrangler.toml        # Cloudflare Workers 設定（D1 綁定、靜態資源）
├─ schema.sql            # D1 資料庫表結構
├─ src/
│  ├─ index.js           # Worker 主程式（所有 /api/* 路由）
│  ├─ bracket.js         # 賽程核心邏輯（單淘汰／雙淘汰、BYE、Reset Match）
│  └─ leaderboard.js     # 排行榜核心邏輯（排序、升降名次）
├─ test/
│  └─ bracket.test.js    # 賽制邏輯的簡易測試
└─ public/                # 靜態前端（首頁、建立賽程、賽程管理、排行榜…）
```

---

## 第一步：推上 GitHub

```bash
cd corner-x
git init                     # 如果還沒 init 過可略過
git add .
git commit -m "Corner X v1"
git branch -M main
git remote add origin https://github.com/<你的帳號>/corner-x.git
git push -u origin main
```

> 沒有 repo 的話，先到 GitHub 網站建立一個新的空 repository（不要勾選自動產生 README，避免衝突），再執行上面指令。

---

## 第二步：建立 Cloudflare D1 資料庫

1. 安裝並登入 Wrangler（如果本機還沒裝過）：
   ```bash
   npm install
   npx wrangler login
   ```
2. 建立 D1 資料庫：
   ```bash
   npx wrangler d1 create corner-x-db
   ```
   指令執行完會印出一段類似：
   ```
   [[d1_databases]]
   binding = "DB"
   database_name = "corner-x-db"
   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```
3. 把印出的 `database_id` 貼到 `wrangler.toml` 裡 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 的位置。
4. 建立資料表（本機測試用 + 正式環境各跑一次）：
   ```bash
   npm run db:init            # 建立本機模擬資料庫（wrangler dev 用）
   npm run db:init:remote     # 建立正式雲端 D1 的資料表
   ```

---

## 第三步：本機測試（可選）

```bash
npm run dev
```
會啟動本機開發伺服器，網址通常是 `http://127.0.0.1:8787`，可以直接用手機瀏覽器連到同一區網 IP 測試手機版介面。

---

## 第四步：部署到 Cloudflare

```bash
npm run deploy
```

部署完成後，Wrangler 會給你一個 `*.workers.dev` 的網址，之後也可以在 Cloudflare Dashboard 裡把自訂網域綁上去。

---

## 之後要更新網站時

改完程式碼後：
```bash
git add .
git commit -m "說明這次改了什麼"
git push
npm run deploy
```
（GitHub 推送與 Cloudflare 部署是兩個獨立動作；也可以之後在 Cloudflare Dashboard 設定「Git 整合」，讓每次 push 到 main 分支就自動部署，不用手動 `npm run deploy`。）

---

## 功能對照（需求 → 實作位置）

| 需求 | 對應位置 |
|---|---|
| 免註冊、自動建立私人 Workspace | `src/index.js` 的 cookie middleware（`cx_ws`） |
| 建立賽程／單淘汰／雙淘汰／BYE／Reset Match | `src/bracket.js` |
| 賽程 Bracket 畫面、記錄比分、自動晉級 | `public/tournament.html` + `public/js/bracket-view.js` |
| 賽程公開分享（唯讀） | `/tournament/:slug`，`public/tournament-public.html` |
| 排行榜（獨立於賽程、手動積分、+/-、自動排序、Top4強調、升降箭頭） | `src/leaderboard.js` + `public/leaderboard.html` |
| 排行榜公開分享（唯讀） | `/leaderboard/:slug`，`public/leaderboard-public.html` |
| 手機優先介面 | `public/css/style.css`（單欄、大按鈕、底部固定操作列） |

## 尚未涵蓋 / 未來可以再加強的地方

- 目前比賽結果**送出後不可修改**（避免誤觸後 bracket 狀態複雜的回溯問題）；若需要「修改已完成比賽」的功能，可以再加。
- 雙淘汰的敗部配對目前採「相鄰配對」，未做防止早輪重複對戰的交叉種子安排；正式比賽量大時可再優化。
- 目前沒有「刪除排行榜參賽者後仍保留歷史名次」的復原機制，刪除即為永久刪除。
