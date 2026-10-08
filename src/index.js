import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createBracket, recordResult, recordWinner } from './bracket.js';
import { emptyLeaderboard, addEntry, setScore, adjustScore, removeEntry, renameEntry, toView } from './leaderboard.js';
import { DEFAULT_POINT_RULES, normalizePointRules, pointsForRank, buildRoundRanking } from './series.js';

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

const ACCESS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomAccessCode(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ACCESS_CODE_CHARS[b % ACCESS_CODE_CHARS.length]).join('');
}

async function newAccessCode(c) {
  for (let i = 0; i < 12; i++) {
    const code = randomAccessCode();
    const row = await c.env.DB.prepare('SELECT id FROM series WHERE access_code = ?').bind(code).first();
    if (!row) return code;
  }
  throw new Error('無法產生活動代碼，請稍後再試');
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
// Corner X V2：活動 / 多場賽事 / 累積積分 API
// ============================================================

function controlToken(c) {
  return c.req.header('X-CX-Control') || new URL(c.req.url).searchParams.get('token') || '';
}

async function loadOwnedSeries(c) {
  const token = controlToken(c);
  if (!token) return null;
  return c.env.DB.prepare('SELECT * FROM series WHERE control_token = ?').bind(token).first();
}

async function seriesParticipants(c, seriesId) {
  const { results } = await c.env.DB.prepare('SELECT id, name, sort_order FROM series_participants WHERE series_id = ? ORDER BY sort_order, id').bind(seriesId).all();
  return results;
}

async function seriesRounds(c, seriesId) {
  const { results } = await c.env.DB.prepare('SELECT * FROM series_rounds WHERE series_id = ? ORDER BY round_no').bind(seriesId).all();
  return results.map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

async function overallLeaderboard(c, seriesId) {
  const participants = await seriesParticipants(c, seriesId);
  const rounds = await seriesRounds(c, seriesId);
  const byParticipant = new Map(participants.map((p) => [p.id, { id: p.id, name: p.name, rounds: [], total: 0, lastRank: null }]));
  for (const r of rounds) {
    const { results } = await c.env.DB.prepare('SELECT participant_id, rank, points FROM series_round_points WHERE round_id = ?').bind(r.id).all();
    const pointsMap = new Map(results.map((x) => [x.participant_id, x]));
    for (const p of participants) {
      const row = pointsMap.get(p.id);
      const points = row ? Number(row.points) || 0 : 0;
      const rank = row?.rank ?? null;
      const item = byParticipant.get(p.id);
      item.rounds.push({ roundId: r.id, roundNo: r.round_no, points, rank });
      item.total += points;
      if (rank != null) item.lastRank = rank;
    }
  }

  // 先計算每一個「已完成場次」結束時的累積排名，供本場排名變化箭頭使用。
  const completedRounds = rounds.filter((r) => r.status === 'done');
  const completedRankMaps = [];
  for (let ri = 0; ri < completedRounds.length; ri++) {
    const totals = participants.map((p) => {
      const item = byParticipant.get(p.id);
      let total = 0;
      for (let i = 0; i <= ri; i++) {
        const q = item.rounds.find((x) => x.roundId === completedRounds[i].id);
        total += q ? Number(q.points) || 0 : 0;
      }
      return { id: p.id, total };
    });
    const rankMap = new Map();
    totals.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const aItem = byParticipant.get(a.id);
      const bItem = byParticipant.get(b.id);
      for (let i = ri; i >= 0; i--) {
        const ar = aItem.rounds.find((x) => x.roundId === completedRounds[i].id)?.rank ?? 999999;
        const br = bItem.rounds.find((x) => x.roundId === completedRounds[i].id)?.rank ?? 999999;
        if (ar !== br) return ar - br;
      }
      return aItem.name.localeCompare(bItem.name, 'zh-Hant');
    });
    totals.forEach((x, i) => rankMap.set(x.id, i + 1));
    completedRankMaps.push(rankMap);
  }

  const list = [...byParticipant.values()];
  list.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // 同分：最近一場排名較高者優先，再往前一場比較。
    for (let i = Math.max(a.rounds.length, b.rounds.length) - 1; i >= 0; i--) {
      const ar = a.rounds[i]?.rank ?? 999999;
      const br = b.rounds[i]?.rank ?? 999999;
      if (ar !== br) return ar - br;
    }
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
  const currentRankMap = new Map(list.map((x, i) => [x.id, i + 1]));
  const previousRankMap = completedRankMaps.length >= 2 ? completedRankMaps[completedRankMaps.length - 2] : null;
  return list.map((x, i) => ({
    ...x,
    overallRank: i + 1,
    previousRank: previousRankMap ? previousRankMap.get(x.id) || null : null,
    rankChange: previousRankMap ? (previousRankMap.get(x.id) || 0) - (i + 1) : 0,
    currentRank: currentRankMap.get(x.id),
  }));
}

async function publicSeriesPayload(c, row) {
  const participants = await seriesParticipants(c, row.id);
  const rounds = await seriesRounds(c, row.id);
  const overall = await overallLeaderboard(c, row.id);
  const withPoints = [];
  let latestCall = null;
  for (const r of rounds) {
    const { results } = await c.env.DB.prepare('SELECT rp.participant_id, rp.rank, rp.points, rp.source, rp.locked, p.name FROM series_round_points rp JOIN series_participants p ON p.id = rp.participant_id WHERE rp.round_id = ? ORDER BY rp.rank').bind(r.id).all();
    const roundData = r.data;
    const call = roundData && roundData.call ? roundData.call : null;
    if (call && (!latestCall || String(call.createdAt) > String(latestCall.createdAt))) latestCall = { ...call, roundId: r.id };
    withPoints.push({ ...r, points: results });
  }
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    location: row.location,
    status: row.status,
    pointRules: JSON.parse(row.point_rules),
    participants,
    rounds: withPoints,
    overall,
    call: latestCall,
    readOnly: true,
  };
}

app.post('/api/series', async (c) => {
  const ws = c.get('ws');
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const eventDate = String(body.eventDate || '').trim() || null;
  const location = String(body.location || '').trim() || null;
  const players = Array.isArray(body.players) ? body.players.map((p) => String(p).trim()).filter(Boolean) : [];
  const format = body.format === 'double' ? 'double' : 'single';
  const pointRules = normalizePointRules(body.pointRules || DEFAULT_POINT_RULES);
  if (!name) return jsonError(c, 400, '請輸入活動名稱');
  if (players.length < 2) return jsonError(c, 400, '至少需要 2 位參賽者');
  if (new Set(players).size !== players.length) return jsonError(c, 400, '參賽者名稱不可重複');
  let data;
  try { data = createBracket(players, format); } catch (e) { return jsonError(c, 400, e.message); }
  const id = newId('s');
  const roundId = newId('r');
  const control = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const share = newSlug();
  const accessCode = await newAccessCode(c);
  const now = new Date().toISOString();
  const tx = c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO series (id, workspace_id, name, event_date, location, status, control_token, share_slug, access_code, point_rules, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, ws, name, eventDate, location, data.champion ? 'done' : 'ongoing', control, share, accessCode, JSON.stringify(pointRules), now, now),
    ...players.map((name, i) => c.env.DB.prepare('INSERT INTO series_participants (id, series_id, name, sort_order) VALUES (?,?,?,?)').bind(newId('p'), id, name, i)),
    c.env.DB.prepare('INSERT INTO series_rounds (id, series_id, round_no, name, format, status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(roundId, id, 1, '第 1 場', format, data.champion ? 'done' : 'ongoing', JSON.stringify(data), now, now),
  ]);
  await tx;
  return c.json({ id, name, controlToken: control, accessCode, shareSlug: share, controlUrl: `/series.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(control)}`, shareUrl: `/series-public/${encodeURIComponent(share)}` });
});

app.get('/api/series', async (c) => {
  const ws = c.get('ws');
  const { results } = await c.env.DB.prepare('SELECT id, name, event_date, location, status, share_slug, updated_at FROM series WHERE workspace_id = ? ORDER BY updated_at DESC').bind(ws).all();
  return c.json({ series: results });
});

app.delete('/api/series/:id', async (c) => {
  const ws = c.get('ws');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, name FROM series WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
  if (!row) return jsonError(c, 404, '找不到這個活動');

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM series_round_points WHERE round_id IN (SELECT id FROM series_rounds WHERE series_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM series_round_actions WHERE round_id IN (SELECT id FROM series_rounds WHERE series_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM series_rounds WHERE series_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM series_participants WHERE series_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM series WHERE id = ? AND workspace_id = ?').bind(id, ws),
  ]);

  return c.json({ ok: true, id: row.id, name: row.name });
});

app.get('/api/series/:id', async (c) => {
  const row = await loadOwnedSeries(c);
  if (!row || row.id !== c.req.param('id')) return jsonError(c, 404, '找不到這個活動，或私人控制連結無效');
  let accessCode = row.access_code || '';
  if (!accessCode) {
    accessCode = await newAccessCode(c);
    await c.env.DB.prepare('UPDATE series SET access_code = ?, updated_at = ? WHERE id = ?').bind(accessCode, new Date().toISOString(), row.id).run();
  }
  const payload = await publicSeriesPayload(c, row);
  return c.json({ ...payload, controlToken: controlToken(c), accessCode, shareSlug: row.share_slug, readOnly: false });
});

app.post('/api/series/access', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(code)) return jsonError(c, 400, '請輸入 8 碼活動代碼');
  const row = await c.env.DB.prepare('SELECT id, name, control_token, access_code FROM series WHERE access_code = ?').bind(code).first();
  if (!row) return jsonError(c, 404, '活動代碼不存在或已失效');
  return c.json({ ok: true, id: row.id, name: row.name, controlToken: row.control_token, controlUrl: `/series.html?id=${encodeURIComponent(row.id)}&token=${encodeURIComponent(row.control_token)}` });
});

app.post('/api/series/:id/rounds', async (c) => {
  const row = await loadOwnedSeries(c);
  if (!row || row.id !== c.req.param('id')) return jsonError(c, 404, '找不到這個活動，或私人控制連結無效');
  if (row.status === 'done') return jsonError(c, 400, '活動已結束，無法新增場次');
  const body = await c.req.json().catch(() => ({}));
  const participants = await seriesParticipants(c, row.id);
  const format = body.format === 'double' ? 'double' : 'single';
  const roundName = String(body.name || '').trim() || `第 ${Number(body.roundNo) || 1} 場`;
  const existing = await c.env.DB.prepare('SELECT COALESCE(MAX(round_no),0) AS max_no FROM series_rounds WHERE series_id = ?').bind(row.id).first();
  const roundNo = Number(existing.max_no || 0) + 1;
  let data;
  try { data = createBracket(participants.map((p) => p.name), format); } catch (e) { return jsonError(c, 400, e.message); }
  const id = newId('r');
  const now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO series_rounds (id, series_id, round_no, name, format, status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, row.id, roundNo, roundName, format, data.champion ? 'done' : 'ongoing', JSON.stringify(data), now, now).run();
  await c.env.DB.prepare('UPDATE series SET status = ?, updated_at = ? WHERE id = ?').bind('ongoing', now, row.id).run();
  return c.json({ id, roundNo, name: roundName, format, status: data.champion ? 'done' : 'ongoing', data });
});

async function loadOwnedRound(c) {
  const row = await loadOwnedSeries(c);
  if (!row || row.id !== c.req.param('id')) return { series: null, round: null };
  const round = await c.env.DB.prepare('SELECT * FROM series_rounds WHERE id = ? AND series_id = ?').bind(c.req.param('roundId'), row.id).first();
  return { series: row, round };
}

async function saveRoundAndMaybePoints(c, seriesRow, roundRow, data, previousSnapshot = null) {
  const now = new Date().toISOString();
  const status = data.champion ? 'done' : 'ongoing';
  if (previousSnapshot) {
    await c.env.DB.prepare('INSERT INTO series_round_actions (id, round_id, snapshot, created_at) VALUES (?,?,?,?)').bind(newId('act'), roundRow.id, previousSnapshot, now).run();
  }
  await c.env.DB.prepare('UPDATE series_rounds SET data = ?, status = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(data), status, now, roundRow.id).run();
  await c.env.DB.prepare('UPDATE series SET status = ?, updated_at = ? WHERE id = ?').bind('ongoing', now, seriesRow.id).run();
  if (data.champion) {
    const ranking = buildRoundRanking(data);
    const participants = await seriesParticipants(c, seriesRow.id);
    const byName = new Map(participants.map((p) => [p.name, p]));
    const rules = normalizePointRules(JSON.parse(seriesRow.point_rules));
    for (const item of ranking) {
      const p = byName.get(item.name);
      if (!p) continue;
      const id = newId('rp');
      await c.env.DB.prepare(`INSERT INTO series_round_points (id, round_id, participant_id, rank, points, source, locked, updated_at) VALUES (?,?,?,?,?,?,0,?) ON CONFLICT(round_id, participant_id) DO UPDATE SET rank=excluded.rank, points=excluded.points, source=excluded.source, updated_at=excluded.updated_at`).bind(id, roundRow.id, p.id, item.rank, pointsForRank(item.rank, rules), 'auto', now).run();
    }
  }
  return status;
}

app.post('/api/series/:id/rounds/:roundId/reseed', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const current = JSON.parse(round.data);
  const hasPlayedMatch = (current.matches || []).some((m) => m.status === 'done' && m.winner && m.playerA !== '__BYE__' && m.playerB !== '__BYE__');
  if (hasPlayedMatch) return jsonError(c, 400, '已有比賽結果，賽程對位已鎖定');

  const body = await c.req.json().catch(() => ({}));
  const participants = await seriesParticipants(c, series.id);
  const participantNames = participants.map((p) => p.name);
  let players;
  const mode = body.mode === 'manual' ? 'manual' : 'random';
  if (mode === 'manual') {
    players = Array.isArray(body.players) ? body.players.map((p) => String(p).trim()) : [];
    if (players.length !== participantNames.length || new Set(players).size !== players.length || players.some((p) => !participantNames.includes(p))) {
      return jsonError(c, 400, '手動調整的參賽者名單不完整或有重複');
    }
  } else {
    players = participantNames.slice();
  }

  let data;
  try {
    if (mode === 'manual') {
      // 手動調整只交換「原本有選手的籤位」，BYE 位置完全保留。
      // 前端送回的是重新排序後的選手名單，不包含 BYE。
      const currentSlots = (current.matches || [])
        .filter((m) => m.stage === 'WB' && m.round === 1)
        .sort((a, b) => a.index - b.index)
        .flatMap((m) => [m.playerA, m.playerB]);
      const queue = players.slice();
      const slotOrder = currentSlots.map((slot) => slot === '__BYE__' ? '__BYE__' : queue.shift());
      data = createBracket(participantNames, round.format, {
        shuffle: false,
        preserveSlotOrder: true,
        slotOrder,
      });
    } else {
      data = createBracket(players, round.format, { shuffle: true });
    }
  } catch (e) { return jsonError(c, 400, e.message); }

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO series_round_actions (id, round_id, snapshot, created_at) VALUES (?,?,?,?)').bind(newId('act'), round.id, round.data, now),
    c.env.DB.prepare('UPDATE series_rounds SET data = ?, status = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(data), data.champion ? 'done' : 'ongoing', now, round.id),
    c.env.DB.prepare('UPDATE series SET updated_at = ? WHERE id = ?').bind(now, series.id),
    c.env.DB.prepare('DELETE FROM series_round_points WHERE round_id = ?').bind(round.id),
  ]);
  return c.json({ ok: true, data });
});

app.post('/api/series/:id/rounds/:roundId/matches/:matchId/result', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const body = await c.req.json().catch(() => ({}));
  const data = JSON.parse(round.data);
  const previousSnapshot = JSON.stringify(data);
  try {
    if (body.winner === 'A' || body.winner === 'B') {
      recordWinner(data, c.req.param('matchId'), body.winner);
    } else {
      recordResult(data, c.req.param('matchId'), Number(body.scoreA), Number(body.scoreB));
    }
  } catch (e) { return jsonError(c, 400, e.message); }
  const status = await saveRoundAndMaybePoints(c, series, round, data, previousSnapshot);
  return c.json({ id: round.id, status, data });
});

app.post('/api/series/:id/rounds/:roundId/call', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const body = await c.req.json().catch(() => ({}));
  const matchId = String(body.matchId || '').trim();
  const playerA = String(body.playerA || '').trim();
  const playerB = String(body.playerB || '').trim();
  const matchNo = Number(body.matchNo || 0);
  if (!matchId || !playerA || !playerB || !matchNo) return jsonError(c, 400, '叫號資料不完整');

  const data = JSON.parse(round.data);
  const match = (data.matches || []).find((m) => m.id === matchId);
  if (!match || match.status !== 'ready' || !match.playerA || !match.playerB || match.playerA === '__BYE__' || match.playerB === '__BYE__') {
    return jsonError(c, 400, '這場比賽目前無法叫號');
  }

  const createdAt = new Date().toISOString();
  data.call = {
    id: newId('call'),
    matchId,
    matchNo,
    playerA,
    playerB,
    createdAt,
  };
  await c.env.DB.prepare('UPDATE series_rounds SET data = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(data), createdAt, round.id).run();
  await c.env.DB.prepare('UPDATE series SET updated_at = ? WHERE id = ?').bind(createdAt, series.id).run();
  return c.json({ ok: true, call: { ...data.call, roundId: round.id } });
});

app.post('/api/series/:id/rounds/:roundId/undo', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const action = await c.env.DB.prepare('SELECT * FROM series_round_actions WHERE round_id = ? ORDER BY created_at DESC LIMIT 1').bind(round.id).first();
  if (!action) return jsonError(c, 400, '沒有可以復原的操作');
  const restored = JSON.parse(action.snapshot);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE series_rounds SET data = ?, status = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(restored), restored.champion ? 'done' : 'ongoing', now, round.id),
    c.env.DB.prepare('DELETE FROM series_round_actions WHERE id = ?').bind(action.id),
    c.env.DB.prepare('DELETE FROM series_round_points WHERE round_id = ?').bind(round.id),
  ]);
  if (restored.champion) await saveRoundAndMaybePoints(c, series, round, restored);
  return c.json({ ok: true, data: restored });
});

app.get('/api/series/:id/rounds/:roundId/points', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const { results } = await c.env.DB.prepare('SELECT rp.*, p.name FROM series_round_points rp JOIN series_participants p ON p.id = rp.participant_id WHERE rp.round_id = ? ORDER BY rp.rank').bind(round.id).all();
  return c.json({ points: results, locked: results.length > 0 && results.every((x) => Number(x.locked) === 1) });
});

app.patch('/api/series/:id/rounds/:roundId/points/:participantId', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const existing = await c.env.DB.prepare('SELECT * FROM series_round_points WHERE round_id = ? AND participant_id = ?').bind(round.id, c.req.param('participantId')).first();
  if (!existing) return jsonError(c, 404, '找不到這位參賽者的本場積分');
  if (Number(existing.locked) === 1) return jsonError(c, 400, '本場積分已鎖定');
  const body = await c.req.json().catch(() => ({}));
  const points = Math.max(0, Math.floor(Number(body.points)) || 0);
  await c.env.DB.prepare('UPDATE series_round_points SET points = ?, source = ?, updated_at = ? WHERE round_id = ? AND participant_id = ?').bind(points, 'manual', new Date().toISOString(), round.id, c.req.param('participantId')).run();
  return c.json({ ok: true });
});

app.post('/api/series/:id/rounds/:roundId/points/confirm', async (c) => {
  const { series, round } = await loadOwnedRound(c);
  if (!series || !round) return jsonError(c, 404, '找不到這場比賽');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM series_round_points WHERE round_id = ?').bind(round.id).first();
  if (!Number(count?.n)) return jsonError(c, 400, '本場尚未產生排名積分');
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE series_round_points SET locked = 1, updated_at = ? WHERE round_id = ?').bind(now, round.id).run();
  await c.env.DB.prepare('UPDATE series SET updated_at = ? WHERE id = ?').bind(now, series.id).run();
  return c.json({ ok: true, locked: true });
});

app.post('/api/series/:id/finish', async (c) => {
  const row = await loadOwnedSeries(c);
  if (!row || row.id !== c.req.param('id')) return jsonError(c, 404, '找不到這個活動');
  const rounds = await seriesRounds(c, row.id);
  if (!rounds.length || rounds.some((r) => r.status !== 'done')) return jsonError(c, 400, '所有已建立的場次都完成後才能結束活動');
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE series SET status = ?, updated_at = ? WHERE id = ?').bind('done', now, row.id).run();
  return c.json({ ok: true, status: 'done' });
});

app.post('/api/series/:id/share', async (c) => {
  const row = await loadOwnedSeries(c);
  if (!row || row.id !== c.req.param('id')) return jsonError(c, 404, '找不到這個活動');
  return c.json({ slug: row.share_slug, url: `/series-public/${encodeURIComponent(row.share_slug)}` });
});

app.get('/api/public/series/:slug', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM series WHERE share_slug = ?').bind(c.req.param('slug')).first();
  if (!row) return jsonError(c, 404, '找不到這個活動，或分享連結已失效');
  return c.json(await publicSeriesPayload(c, row));
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

app.get('/series-public/:slug', async (c) => {
  return c.env.ASSETS.fetch(new Request(new URL('/series-public.html', c.req.url)));
});

app.get('/tournament/:slug', async (c) => {
  return c.env.ASSETS.fetch(new Request(new URL('/tournament-public.html', c.req.url)));
});

app.get('/leaderboard/:slug', async (c) => {
  return c.env.ASSETS.fetch(new Request(new URL('/leaderboard-public.html', c.req.url)));
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
