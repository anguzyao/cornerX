// leaderboard.js — 排行榜核心邏輯（純函式）
//
// leaderboard.data = {
//   entries: Entry[]
// }
// Entry = { id, name, score, previousRank: number|null }

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function emptyLeaderboard() {
  return { entries: [] };
}

// 依積分排序（高到低），回傳新陣列，並附上 rank (1-based)
function ranked(entries) {
  return entries
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// 在更新分數/名單前，先把「目前排名」凍結成 previousRank，
// 這樣更新完後才能算出 ↑ / ↓。
function snapshotRanks(data) {
  const r = ranked(data.entries);
  const rankMap = new Map(r.map((e) => [e.id, e.rank]));
  for (const e of data.entries) {
    e.previousRank = rankMap.get(e.id) ?? null;
  }
}

function addEntry(data, name, score) {
  if (!name || !name.trim()) throw new Error('請輸入參賽者名稱');
  snapshotRanks(data);
  const entry = { id: uid('p'), name: name.trim(), score: Number(score) || 0, previousRank: null };
  data.entries.push(entry);
  return entry;
}

function setScore(data, entryId, score) {
  const e = data.entries.find((x) => x.id === entryId);
  if (!e) throw new Error('找不到這位參賽者');
  snapshotRanks(data);
  e.score = Number(score) || 0;
  return e;
}

function adjustScore(data, entryId, delta) {
  const e = data.entries.find((x) => x.id === entryId);
  if (!e) throw new Error('找不到這位參賽者');
  snapshotRanks(data);
  e.score = (Number(e.score) || 0) + Number(delta);
  return e;
}

function removeEntry(data, entryId) {
  snapshotRanks(data);
  data.entries = data.entries.filter((x) => x.id !== entryId);
}

function renameEntry(data, entryId, name) {
  const e = data.entries.find((x) => x.id === entryId);
  if (!e) throw new Error('找不到這位參賽者');
  if (!name || !name.trim()) throw new Error('請輸入參賽者名稱');
  e.name = name.trim();
  return e;
}

// 給前端顯示用：算好 rank + 升降 (up/down/same/new)
function toView(data) {
  const r = ranked(data.entries);
  return r.map((e) => {
    let change = 'same';
    if (e.previousRank == null) change = 'new';
    else if (e.rank < e.previousRank) change = 'up';
    else if (e.rank > e.previousRank) change = 'down';
    return {
      id: e.id,
      name: e.name,
      score: e.score,
      rank: e.rank,
      change,
    };
  });
}

module.exports = { emptyLeaderboard, addEntry, setScore, adjustScore, removeEntry, renameEntry, toView };
