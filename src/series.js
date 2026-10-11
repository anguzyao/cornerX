// series.js — Corner X V2 活動 / 多場積分核心邏輯（純函式）

export const DEFAULT_POINT_RULES = {
  first: 10,
  second: 7,
  third: 5,
  fourth: 3,
  fifthToEighth: 2,
  ninthPlus: 1,
};

export function normalizePointRules(input = {}) {
  const keys = ['first', 'second', 'third', 'fourth', 'fifthToEighth', 'ninthPlus'];
  const out = {};
  for (const key of keys) {
    const n = Number(input[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_POINT_RULES[key];
  }
  return out;
}

export function pointsForRank(rank, rules) {
  const r = normalizePointRules(rules);
  if (rank === 1) return r.first;
  if (rank === 2) return r.second;
  if (rank === 3) return r.third;
  if (rank === 4) return r.fourth;
  if (rank >= 5 && rank <= 8) return r.fifthToEighth;
  return r.ninthPlus;
}

function matchLossRanks(data) {
  const result = new Map();
  for (const m of data.matches || []) {
    if (m.status !== 'done' || !m.loser || m.loser === '__BYE__') continue;
    if (m.loser && !result.has(m.loser)) result.set(m.loser, m.round || 0);
    // 同一選手在雙淘汰可能多次落敗，最後一次才是淘汰結果。
    if (m.loser) result.set(m.loser, Math.max(result.get(m.loser) || 0, m.round || 0));
  }
  return result;
}

/**
 * 產生本場最終排名。1~4 名優先使用明確賽事結果；5 名後依淘汰輪次與 match index
 * 穩定排序，因為積分規則本身將 5~8 與 9+ 分成區間。
 */
export function buildRoundRanking(data) {
  const players = Array.isArray(data.players) ? data.players.filter(Boolean) : [];
  const ordered = [];
  const add = (name) => { if (name && name !== '__BYE__' && !ordered.includes(name)) ordered.push(name); };

  add(data.champion);
  add(data.runnerUp);
  add(data.thirdPlace);
  add(data.fourthPlace);

  // 雙敗賽：總決賽完成後，從實際敗部晉級連線判定第 3、4 名。
  // 第 3 名 = 敗部決賽（送勝者進 Grand Final 的最後一場 LB）敗者。
  // 第 4 名 = 敗部決賽前一場、其勝者晉級敗部決賽的 LB 比賽敗者。
  // 不依賴畫面順序或單純挑最大 round，避免同一輪多場比賽時抓錯人。
  if ((!data.thirdPlace || !data.fourthPlace) && data.grandFinal) {
    const matches = data.matches || [];
    const gf = matches.find((m) => m.id === data.grandFinal && m.status === 'done');
    if (gf) {
      const lbFinal = matches.find((m) =>
        m.stage === 'LB' && m.status === 'done' &&
        m.feedsWinnerTo && m.feedsWinnerTo.matchId === data.grandFinal
      );
      if (lbFinal) {
        add(lbFinal.loser);
        if (!data.fourthPlace) {
          const lbPreFinal = matches.find((m) =>
            m.stage === 'LB' && m.status === 'done' && m.id !== lbFinal.id &&
            m.feedsWinnerTo && m.feedsWinnerTo.matchId === lbFinal.id
          );
          if (lbPreFinal) add(lbPreFinal.loser);
        }
      }
    }
  }

  const loss = matchLossRanks(data);
  const remaining = players.filter((p) => !ordered.includes(p));
  const matchIndex = new Map();
  for (const m of data.matches || []) {
    if (m.status !== 'done' || !m.loser) continue;
    matchIndex.set(m.loser, m.index || 0);
  }
  remaining.sort((a, b) => {
    const lr = (loss.get(b) || 0) - (loss.get(a) || 0);
    if (lr) return lr;
    return (matchIndex.get(a) || 0) - (matchIndex.get(b) || 0);
  });
  remaining.forEach(add);

  return ordered.map((name, i) => ({ rank: i + 1, name }));
}

export function rankMap(ranking) {
  return new Map(ranking.map((x) => [x.name, x.rank]));
}
