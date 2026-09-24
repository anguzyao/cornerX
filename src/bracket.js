// bracket.js — 賽程核心邏輯（純函式，無外部依賴，方便單元測試）
//
// 資料結構說明：
// tournament.data = {
//   format: 'single' | 'double',
//   players: string[],                 // 建立當下輸入的原始名單
//   matches: Match[],
//   champion: string | null,
//   runnerUp: string | null,
// }
//
// Match = {
//   id: string,
//   stage: 'WB' | 'LB' | 'GF',          // Winners / Losers / Grand Final
//   round: number,                      // 該 stage 內的第幾輪 (1-based)
//   index: number,                      // 該輪內第幾場 (0-based)
//   playerA: string | null,             // null = 尚未決定
//   playerB: string | null,
//   scoreA: number | null,
//   scoreB: number | null,
//   winner: string | null,
//   status: 'pending' | 'ready' | 'done',   // pending=有空位, ready=雙方已知可比賽, done=已完成
//   feedsWinnerTo: { matchId: string, slot: 'A'|'B' } | null,
//   feedsLoserTo: { matchId: string, slot: 'A'|'B' } | null,
//   isReset: boolean | undefined,       // GF2 (Reset Match) 標記
// }

const BYE = '__BYE__';

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 建立一場新賽程的完整 bracket。
 * @param {string[]} players 參賽者名單（至少 2 人）
 * @param {'single'|'double'} format
 */
function createBracket(players, format) {
  if (!Array.isArray(players) || players.length < 2) {
    throw new Error('至少需要 2 位參賽者');
  }
  const N = nextPowerOfTwo(players.length);
  const seeded = shuffle(players);
  while (seeded.length < N) seeded.push(BYE);

  const matches = [];
  const k = Math.log2(N); // WB 輪數

  // ---- Winners Bracket ----
  // wbRounds[r] = 該輪 match id 陣列（r 從 1 開始）
  const wbRounds = [];
  const round1 = [];
  for (let i = 0; i < N / 2; i++) {
    const m = {
      id: uid('wb1'),
      stage: 'WB',
      round: 1,
      index: i,
      playerA: seeded[i * 2],
      playerB: seeded[i * 2 + 1],
      scoreA: null,
      scoreB: null,
      winner: null,
      status: 'ready',
      feedsWinnerTo: null,
      feedsLoserTo: null,
    };
    matches.push(m);
    round1.push(m.id);
  }
  wbRounds.push(round1);

  for (let r = 2; r <= k; r++) {
    const prev = wbRounds[r - 2];
    const cur = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const m = {
        id: uid('wb' + r),
        stage: 'WB',
        round: r,
        index: i,
        playerA: null,
        playerB: null,
        scoreA: null,
        scoreB: null,
        winner: null,
        status: 'pending',
        feedsWinnerTo: null,
        feedsLoserTo: null,
      };
      matches.push(m);
      cur.push(m.id);
      const feedA = findMatch(matches, prev[i * 2]);
      const feedB = findMatch(matches, prev[i * 2 + 1]);
      feedA.feedsWinnerTo = { matchId: m.id, slot: 'A' };
      feedB.feedsWinnerTo = { matchId: m.id, slot: 'B' };
    }
    wbRounds.push(cur);
  }

  let grandFinal = null;

  if (format === 'double' && k >= 2) {
    // ---- Losers Bracket ----
    // lbRounds[r] (r 從 1 開始) = match id 陣列
    const lbRounds = [];
    const totalLbRounds = 2 * (k - 1);

    // LB round 1：WB round1 的敗者互打
    const lb1 = [];
    const wb1losersSlots = []; // 記錄要接 WB round1 敗者的位置，之後統一連結
    for (let i = 0; i < wbRounds[0].length / 2; i++) {
      const m = {
        id: uid('lb1'),
        stage: 'LB',
        round: 1,
        index: i,
        playerA: null,
        playerB: null,
        scoreA: null,
        scoreB: null,
        winner: null,
        status: 'pending',
        feedsWinnerTo: null,
        feedsLoserTo: null,
      };
      matches.push(m);
      lb1.push(m.id);
    }
    lbRounds.push(lb1);
    // 連結 WB round1 敗者 -> LB round1（相鄰配對）
    for (let i = 0; i < wbRounds[0].length; i++) {
      const wbm = findMatch(matches, wbRounds[0][i]);
      const lbm = findMatch(matches, lb1[Math.floor(i / 2)]);
      wbm.feedsLoserTo = { matchId: lbm.id, slot: i % 2 === 0 ? 'A' : 'B' };
    }

    for (let r = 2; r <= totalLbRounds; r++) {
      const prevIds = lbRounds[r - 2];
      const cur = [];
      if (r % 2 === 0) {
        // 偶數輪：上一輪(LB)勝者 vs 新掉下來的 WB 敗者
        const wbFeedRound = r / 2 + 1; // 對應 WB 第幾輪敗者掉下來
        const wbFeedMatches = wbRounds[wbFeedRound - 1];
        for (let i = 0; i < prevIds.length; i++) {
          const m = {
            id: uid('lb' + r),
            stage: 'LB',
            round: r,
            index: i,
            playerA: null,
            playerB: null,
            scoreA: null,
            scoreB: null,
            winner: null,
            status: 'pending',
            feedsWinnerTo: null,
            feedsLoserTo: null,
          };
          matches.push(m);
          cur.push(m.id);
          const prevM = findMatch(matches, prevIds[i]);
          prevM.feedsWinnerTo = { matchId: m.id, slot: 'A' };
          const wbM = findMatch(matches, wbFeedMatches[i]);
          wbM.feedsLoserTo = { matchId: m.id, slot: 'B' };
        }
      } else {
        // 奇數輪 (>=3)：上一輪勝者互打（純消化輪）
        for (let i = 0; i < prevIds.length / 2; i++) {
          const m = {
            id: uid('lb' + r),
            stage: 'LB',
            round: r,
            index: i,
            playerA: null,
            playerB: null,
            scoreA: null,
            scoreB: null,
            winner: null,
            status: 'pending',
            feedsWinnerTo: null,
            feedsLoserTo: null,
          };
          matches.push(m);
          cur.push(m.id);
          const feedA = findMatch(matches, prevIds[i * 2]);
          const feedB = findMatch(matches, prevIds[i * 2 + 1]);
          feedA.feedsWinnerTo = { matchId: m.id, slot: 'A' };
          feedB.feedsWinnerTo = { matchId: m.id, slot: 'B' };
        }
      }
      lbRounds.push(cur);
    }

    // ---- Grand Final ----
    const gf = {
      id: uid('gf'),
      stage: 'GF',
      round: 1,
      index: 0,
      playerA: null, // WB 冠軍
      playerB: null, // LB 冠軍
      scoreA: null,
      scoreB: null,
      winner: null,
      status: 'pending',
      feedsWinnerTo: null,
      feedsLoserTo: null,
    };
    matches.push(gf);
    grandFinal = gf.id;

    const wbFinal = findMatch(matches, wbRounds[wbRounds.length - 1][0]);
    wbFinal.feedsWinnerTo = { matchId: gf.id, slot: 'A' };
    const lbFinal = findMatch(matches, lbRounds[lbRounds.length - 1][0]);
    lbFinal.feedsWinnerTo = { matchId: gf.id, slot: 'B' };
    // WB 決賽的敗者，直接進入 LB 最終輪（LB 最後一輪剛好是偶數輪，會自動去接 "WB 該輪敗者"）
    wbFinal.feedsLoserTo = { matchId: lbFinal.id, slot: 'B' };
  }

  const data = {
    format,
    players,
    matches,
    champion: null,
    runnerUp: null,
    grandFinal,
  };

  // 建立完後跑一次結算，處理起手就有 BYE 的狀況
  settleAll(data);
  return data;
}

function findMatch(matches, id) {
  return matches.find((m) => m.id === id) || null;
}

function findMatchIn(data, id) {
  return findMatch(data.matches, id);
}

// 檢查一場比賽是否雙方都已確定，若確定則標記 ready
function refreshStatus(m) {
  if (m.status === 'done') return;
  if (m.playerA && m.playerB) m.status = 'ready';
}

/**
 * 把 winner/loser 的名字放進下一場對應的位置，並連鎖處理 BYE。
 */
function propagate(data, match) {
  const { winner, loser } = match;

  if (match.feedsWinnerTo && winner) {
    const target = findMatchIn(data, match.feedsWinnerTo.matchId);
    if (target) {
      if (match.feedsWinnerTo.slot === 'A') target.playerA = winner;
      else target.playerB = winner;
      refreshStatus(target);
      trySettleBye(data, target);
    }
  }
  if (match.feedsLoserTo) {
    // loser 為 null 代表這場其實是 BYE 產生的勝利，沒有真正的敗者 -> 對方位置也算 BYE，繼續往下連鎖
    const dropVal = loser || BYE;
    const target = findMatchIn(data, match.feedsLoserTo.matchId);
    if (target) {
      if (match.feedsLoserTo.slot === 'A') target.playerA = dropVal;
      else target.playerB = dropVal;
      refreshStatus(target);
      trySettleBye(data, target);
    }
  }
}

// 若某場比賽其中一方是 BYE 而另一方已確定，直接判定晉級，並繼續連鎖
function trySettleBye(data, match) {
  if (match.status === 'done') return;
  if (match.playerA && match.playerB) {
    if (match.playerA === BYE && match.playerB === BYE) {
      // 兩邊都輪空（極少數情況），隨機視為 A 晉級但不記真人成績
      finishMatch(data, match, 0, 0, match.playerA);
    } else if (match.playerA === BYE) {
      finishMatch(data, match, null, null, match.playerB);
    } else if (match.playerB === BYE) {
      finishMatch(data, match, null, null, match.playerA);
    }
  }
}

function finishMatch(data, match, scoreA, scoreB, forcedWinner) {
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  const winner = forcedWinner || (scoreA > scoreB ? match.playerA : match.playerB);
  const loser = winner === match.playerA ? match.playerB : match.playerA;
  match.winner = winner;
  match.loser = loser === BYE ? null : loser;
  match.status = 'done';
  propagate(data, match);

  // 判斷冠軍
  if (data.grandFinal) {
    const gf = findMatchIn(data, data.grandFinal);
    if (gf.status === 'done') {
      if (!gf.isReset) {
        if (gf.winner === gf.playerB) {
          // LB 冠軍贏了第一場總決賽 -> 觸發 Reset Match
          ensureResetMatch(data, gf);
        } else {
          data.champion = gf.winner;
          data.runnerUp = gf.winner === gf.playerA ? gf.playerB : gf.playerA;
        }
      } else {
        data.champion = gf.winner;
        data.runnerUp = gf.winner === gf.playerA ? gf.playerB : gf.playerA;
      }
    }
  } else {
    // 單淘汰：找最後一輪 WB 比賽
    const lastRound = Math.max(...data.matches.filter((m) => m.stage === 'WB').map((m) => m.round));
    const final = data.matches.find((m) => m.stage === 'WB' && m.round === lastRound);
    if (final && final.status === 'done') {
      data.champion = final.winner;
      data.runnerUp = final.winner === final.playerA ? final.playerB : final.playerA;
    }
  }
}

function ensureResetMatch(data, gf) {
  const already = data.matches.find((m) => m.stage === 'GF' && m.isReset);
  if (already) return;
  const reset = {
    id: uid('gf2'),
    stage: 'GF',
    round: 2,
    index: 0,
    playerA: gf.playerA, // 原本 WB 冠軍（吞下人生第一敗）
    playerB: gf.playerB, // 原本 LB 冠軍（再贏一場就奪冠）
    scoreA: null,
    scoreB: null,
    winner: null,
    status: 'ready',
    feedsWinnerTo: null,
    feedsLoserTo: null,
    isReset: true,
  };
  data.matches.push(reset);
  data.grandFinal = reset.id;
}

// 建立完 bracket 後，跑一輪把所有一開始就滿足 BYE 條件的比賽處理掉
function settleAll(data) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 200) {
    changed = false;
    guard++;
    for (const m of data.matches) {
      if (m.status !== 'done' && m.playerA && m.playerB) {
        if (m.playerA === BYE || m.playerB === BYE) {
          trySettleBye(data, m);
          changed = true;
        } else {
          refreshStatus(m);
        }
      }
    }
  }
}

/**
 * 記錄一場比賽的比分並往後推進。
 */
function recordResult(data, matchId, scoreA, scoreB) {
  const match = findMatchIn(data, matchId);
  if (!match) throw new Error('找不到這場比賽');
  if (match.status === 'done') throw new Error('這場比賽已經完成');
  if (!match.playerA || !match.playerB) throw new Error('這場比賽尚未確定雙方選手');
  if (match.playerA === BYE || match.playerB === BYE) throw new Error('輪空比賽不需手動輸入比分');
  if (typeof scoreA !== 'number' || typeof scoreB !== 'number' || scoreA === scoreB) {
    throw new Error('比分不合法（需為數字，且不可平手）');
  }
  finishMatch(data, match, scoreA, scoreB, null);
  return data;
}

module.exports = { createBracket, recordResult, BYE };
