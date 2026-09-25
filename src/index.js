import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createBracket, recordResult } from './bracket.js';
import { emptyLeaderboard, addEntry, setScore, adjustScore, removeEntry, renameEntry, toView } from './leaderboard.js';

const app = new Hono();

const WORKSPACE_COOKIE = 'cx_ws';
const ONE_YEAR = 60 * 60 * 24 * 365;

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

function newSlug() {
  // 短一點、適合放在網址列，好分享
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

// ---------- workspace middleware：全站都套用，自動建立/辨識私人空間 ----------
app.use('*', async (c, next) => {
  const isHttps = new URL(c.req.url).protocol === 'https:';
  let ws = getCookie(c, WORKSPACE_COOKIE);
  if (!ws) {
    ws = newId('ws');
    await c.env.DB.prepare('INSERT INTO workspaces (id) VALUES (?)').bind(ws).run();
    setCookie(c, WORKSPACE_COOKIE, ws, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps,
      path: '/',
      maxAge: ONE_YEAR,
    });
  } else {
    // 確保 row 存在（例如資料庫重建過）
    await c.env.DB.prepare('INSERT OR IGNORE INTO workspaces (id) VALUES (?)').bind(ws).run();
  }
  c.set('ws', ws);
  await next();
});

function jsonError(c, status, message) {
  return c.json({ error: message }, status);
}

// ============================================================
// 賽程 API
// ============================================================

app.post('/api/tournaments', async (c) => {
  const ws = c.get('ws');
  const body = await c.req.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const players = Array.isArray(body.players) ? body.players.map((p) => String(p).trim()).filter(Boolean) : [];
  const format = body.format === 'double' ? 'double' : 'single';

  if (!name) return jsonError(c, 400, '請輸入賽事名稱');
  if (players.length < 2) return jsonError(c, 400, '至少需要 2 位參賽者');
  if (new Set(players).size !== players.length) return jsonError(c, 400, '參賽者名稱不可重複');

  let data;
  try {
    data = createBracket(players, format);
  } catch (e) {
    return jsonError(c, 400, e.message);
  }

  const id = newId('t');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO tournaments (id, workspace_id, name, format, status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  )
    .bind(id, ws, name, format, data.champion ? 'done' : 'ongoing', JSON.stringify(data), now, now)
    .run();

  return c.json({ id, name, format, status: data.champion ? 'done' : 'ongoing', data });
});

app.get('/api/tournaments', async (c) => {
  const ws = c.get('ws');
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, format, status, share_slug, updated_at FROM tournaments WHERE workspace_id = ? ORDER BY updated_at DESC'
  )
    .bind(ws)
    .all();
  return c.json({ tournaments: results });
});

app.get('/api/tournaments/recent', async (c) => {
  const ws = c.get('ws');
  const row = await c.env.DB.prepare(
    'SELECT id, name, format, status, updated_at FROM tournaments WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1'
  )
    .bind(ws)
    .first();
  return c.json({ tournament: row || null });
});

async function loadOwnedTournament(c) {
  const ws = c.get('ws');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM tournaments WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
  return row;
}

app.get('/api/tournaments/:id', async (c) => {
  const row = await loadOwnedTournament(c);
  if (!row) return jsonError(c, 404, '找不到這個賽程');
  return c.json({
    id: row.id,
    name: row.name,
    format: row.format,
    status: row.status,
    shareSlug: row.share_slug,
    data: JSON.parse(row.data),
  });
});

app.post('/api/tournaments/:id/matches/:matchId/result', async (c) => {
  const row = await loadOwnedTournament(c);
  if (!row) return jsonError(c, 404, '找不到這個賽程');
  const body = await c.req.json().catch(() => ({}));
  const scoreA = Number(body.scoreA);
  const scoreB = Number(body.scoreB);
  const data = JSON.parse(row.data);
  try {
    recordResult(data, c.req.param('matchId'), scoreA, scoreB);
  } catch (e) {
    return jsonError(c, 400, e.message);
  }
  const status = data.champion ? 'done' : 'ongoing';
  await c.env.DB.prepare('UPDATE tournaments SET data = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(data), status, new Date().toISOString(), row.id)
    .run();
  return c.json({ id: row.id, name: row.name, format: row.format, status, shareSlug: row.share_slug, data });
});

app.post('/api/tournaments/:id/share', async (c) => {
  const row = await loadOwnedTournament(c);
  if (!row) return jsonError(c, 404, '找不到這個賽程');
  let slug = row.share_slug;
  if (!slug) {
    slug = newSlug();
    await c.env.DB.prepare('UPDATE tournaments SET share_slug = ? WHERE id = ?').bind(slug, row.id).run();
  }
  return c.json({ slug, url: `/tournament/${slug}` });
});

app.delete('/api/tournaments/:id', async (c) => {
  const row = await loadOwnedTournament(c);
  if (!row) return jsonError(c, 404, '找不到這個賽程');
  await c.env.DB.prepare('DELETE FROM tournaments WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

// 公開唯讀
app.get('/api/public/tournaments/:slug', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM tournaments WHERE share_slug = ?').bind(c.req.param('slug')).first();
  if (!row) return jsonError(c, 404, '找不到這個賽程，或分享連結已失效');
  return c.json({
    id: row.id,
    name: row.name,
    format: row.format,
    status: row.status,
    data: JSON.parse(row.data),
    readOnly: true,
  });
});

// ============================================================
// 排行榜 API
// ============================================================

app.post('/api/leaderboards', async (c) => {
  const ws = c.get('ws');
  const body = await c.req.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return jsonError(c, 400, '請輸入排行榜名稱');

  const id = newId('lb');
  const now = new Date().toISOString();
  const data = emptyLeaderboard();
  await c.env.DB.prepare(
    'INSERT INTO leaderboards (id, workspace_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(id, ws, name, JSON.stringify(data), now, now)
    .run();
  return c.json({ id, name, entries: toView(data) });
});

app.get('/api/leaderboards', async (c) => {
  const ws = c.get('ws');
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, share_slug, updated_at FROM leaderboards WHERE workspace_id = ? ORDER BY updated_at DESC'
  )
    .bind(ws)
    .all();
  return c.json({ leaderboards: results });
});

async function loadOwnedLeaderboard(c) {
  const ws = c.get('ws');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM leaderboards WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
  return row;
}

app.get('/api/leaderboards/:id', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  const data = JSON.parse(row.data);
  return c.json({ id: row.id, name: row.name, shareSlug: row.share_slug, entries: toView(data) });
});

async function saveLeaderboard(c, row, data) {
  await c.env.DB.prepare('UPDATE leaderboards SET data = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(data), new Date().toISOString(), row.id)
    .run();
}

app.post('/api/leaderboards/:id/entries', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  const body = await c.req.json().catch(() => ({}));
  const data = JSON.parse(row.data);
  try {
    addEntry(data, body.name, body.score ?? 0);
  } catch (e) {
    return jsonError(c, 400, e.message);
  }
  await saveLeaderboard(c, row, data);
  return c.json({ id: row.id, name: row.name, shareSlug: row.share_slug, entries: toView(data) });
});

app.patch('/api/leaderboards/:id/entries/:entryId', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  const body = await c.req.json().catch(() => ({}));
  const data = JSON.parse(row.data);
  try {
    if (body.score !== undefined) setScore(data, c.req.param('entryId'), body.score);
    if (body.name !== undefined) renameEntry(data, c.req.param('entryId'), body.name);
  } catch (e) {
    return jsonError(c, 400, e.message);
  }
  await saveLeaderboard(c, row, data);
  return c.json({ id: row.id, name: row.name, shareSlug: row.share_slug, entries: toView(data) });
});

app.post('/api/leaderboards/:id/entries/:entryId/adjust', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  const body = await c.req.json().catch(() => ({}));
  const data = JSON.parse(row.data);
  try {
    adjustScore(data, c.req.param('entryId'), Number(body.delta) || 0);
  } catch (e) {
    return jsonError(c, 400, e.message);
  }
  await saveLeaderboard(c, row, data);
  return c.json({ id: row.id, name: row.name, shareSlug: row.share_slug, entries: toView(data) });
});

app.delete('/api/leaderboards/:id/entries/:entryId', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  const data = JSON.parse(row.data);
  removeEntry(data, c.req.param('entryId'));
  await saveLeaderboard(c, row, data);
  return c.json({ id: row.id, name: row.name, shareSlug: row.share_slug, entries: toView(data) });
});

app.post('/api/leaderboards/:id/share', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  let slug = row.share_slug;
  if (!slug) {
    slug = newSlug();
    await c.env.DB.prepare('UPDATE leaderboards SET share_slug = ? WHERE id = ?').bind(slug, row.id).run();
  }
  return c.json({ slug, url: `/leaderboard/${slug}` });
});

app.delete('/api/leaderboards/:id', async (c) => {
  const row = await loadOwnedLeaderboard(c);
  if (!row) return jsonError(c, 404, '找不到這個排行榜');
  await c.env.DB.prepare('DELETE FROM leaderboards WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

app.get('/api/public/leaderboards/:slug', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM leaderboards WHERE share_slug = ?').bind(c.req.param('slug')).first();
  if (!row) return jsonError(c, 404, '找不到這個排行榜，或分享連結已失效');
  const data = JSON.parse(row.data);
  return c.json({ id: row.id, name: row.name, entries: toView(data), readOnly: true });
});

// ============================================================
// 公開分享頁面（動態 slug，交給靜態外殼 + 前端 JS 依網址讀取）
// ============================================================

app.get('/tournament/:slug', async (c) => {
  return c.env.ASSETS.fetch(new Request(new URL('/tournament-public.html', c.req.url)));
});

app.get('/leaderboard/:slug', async (c) => {
  return c.env.ASSETS.fetch(new Request(new URL('/leaderboard-public.html', c.req.url)));
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
