// bracket-view.js — 畫出 bracket、處理比賽結果輸入的 modal
// 依賴 app.js (CX)

const BYE = '__BYE__';

function playerLabel(name) {
  if (name === BYE) return '（輪空）';
  if (!name) return '待定';
  return name;
}

function groupByRound(matches) {
  const rounds = {};
  for (const m of matches) {
    (rounds[m.round] = rounds[m.round] || []).push(m);
  }
  return Object.keys(rounds)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => rounds[r].sort((a, b) => a.index - b.index));
}

function getMatchOrder(matches) {
  const wbRounds = matches.filter((m) => m.stage === 'WB').map((m) => m.round || 0);
  const finalRound = wbRounds.length ? Math.max(...wbRounds) : 0;
  const playable = matches.filter((m) => m.playerA !== BYE && m.playerB !== BYE);
  const stageRank = (m) => {
    // 單淘汰的最後兩場固定為：季軍賽 → 總決賽。
    // 單淘汰總決賽本身仍是 WB 的最後一輪，因此要特別排到 TP 後面。
    if (m.stage === 'WB' && m.round === finalRound) return 3;
    if (m.stage === 'TP') return 2;
    if (m.stage === 'GF') return 3;
    if (m.stage === 'LB') return 1;
    return 0;
  };
  playable.sort((a, b) => {
    const ka = [stageRank(a), a.stage === 'WB' ? (a.round || 0) : (a.round || 0), a.index || 0];
    const kb = [stageRank(b), b.stage === 'WB' ? (b.round || 0) : (b.round || 0), b.index || 0];
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return String(a.id).localeCompare(String(b.id));
  });
  return new Map(playable.map((m, i) => [m.id, i + 1]));
}

function isPlayableMatch(m) {
  return m.playerA && m.playerB && m.playerA !== BYE && m.playerB !== BYE;
}

function findCurrentMatch(matches) {
  const orderMap = getMatchOrder(matches);
  return matches
    .filter((m) => m.status === 'ready' && isPlayableMatch(m))
    .sort((a, b) => (orderMap.get(a.id) || 9999) - (orderMap.get(b.id) || 9999))[0] || null;
}

function matchCardHtml(m, editable, orderMap, currentMatchId) {
  const rows = ['A', 'B'].map((slot) => {
    const name = slot === 'A' ? m.playerA : m.playerB;
    const score = slot === 'A' ? m.scoreA : m.scoreB;
    const isWinner = m.status === 'done' && m.winner === name && name !== BYE;
    const isBye = name === BYE;
    const cls = ['match-row', isWinner ? 'winner' : '', isBye ? 'bye' : ''].filter(Boolean).join(' ');
    const scoreHtml = m.status === 'done' && m.resultMode === 'winner' && m.winner === name ? `<span class="pscore quick-win-label">勝</span>` : (m.status === 'done' && score !== null && score !== undefined ? `<span class="pscore">${score}</span>` : '');
    return `<div class="${cls}"><span class="pname">${CX.esc(playerLabel(name))}</span>${scoreHtml}</div>`;
  });
  const clickable = editable && m.status === 'ready' && isPlayableMatch(m);
  const isCurrent = currentMatchId === m.id;
  const cls = ['match-card', clickable ? 'clickable' : '', isCurrent ? 'current-match' : '', m.status === 'done' ? 'completed-match' : ''].filter(Boolean).join(' ');
  const order = orderMap.get(m.id);
  const orderHtml = order ? `<div class="match-order ${isCurrent ? 'current' : ''}">${isCurrent ? '▶ ' : ''}第 ${order} 場${isCurrent ? ' · 進行中' : ''}</div>` : '';
  return `<div class="${cls}" data-match-id="${m.id}">${orderHtml}${rows.join('')}</div>`;
}

function stageColumnsHtml(matchesInStage, editable, roundLabelFn, orderMap, currentMatchId) {
  const cols = groupByRound(matchesInStage);
  return `<div class="bracket-scroll"><div class="bracket">${cols
    .map((col, i) => {
      const connect = i < cols.length - 1 ? 'connect' : '';
      return `<div class="bracket-col ${connect}"><div class="col-label">${roundLabelFn(col[0].round, cols.length)}</div>${col
        .map((m) => matchCardHtml(m, editable, orderMap, currentMatchId))
        .join('')}</div>`;
    })
    .join('')}</div></div>`;
}

function wbRoundLabel(round, total) {
  if (round === total) return '決賽';
  if (round === total - 1 && total > 1) return '準決賽';
  return `第 ${round} 輪`;
}
function lbRoundLabel(round, total) {
  if (round === total) return 'LB 決賽';
  return `LB 第 ${round} 輪`;
}

function renderBracket(container, tData, opts) {
  const editable = !!opts.editable;
  const matches = tData.matches;
  const orderMap = getMatchOrder(matches);
  const currentMatch = findCurrentMatch(matches);
  const currentMatchId = currentMatch ? currentMatch.id : null;
  const wb = matches.filter((m) => m.stage === 'WB');
  const lb = matches.filter((m) => m.stage === 'LB');
  const gf = matches.filter((m) => m.stage === 'GF').sort((a, b) => a.round - b.round);
  const tp = matches.filter((m) => m.stage === 'TP');

  let html = '';

  if (tData.champion) {
    html += `<div class="champion-banner">
      <div class="medal">🏆</div>
      <div>
        <div class="label">冠軍 CHAMPION</div>
        <div class="name">${CX.esc(tData.champion)}</div>
        ${tData.runnerUp ? `<div class="hint">亞軍：${CX.esc(tData.runnerUp)}</div>` : ''}
      </div>
    </div>`;
  }

  if (currentMatch) {
    const currentOrder = orderMap.get(currentMatch.id);
    html += `<div class="current-match-banner"><span class="current-match-dot"></span><div><strong>現在進行：第 ${currentOrder} 場</strong><span>${CX.esc(playerLabel(currentMatch.playerA))} <b>VS</b> ${CX.esc(playerLabel(currentMatch.playerB))}</span></div></div>`;
  }
  html += `<div class="stage-heading wb">${lb.length ? 'WINNERS BRACKET 勝部' : '賽程 BRACKET'}</div>`;
  html += stageColumnsHtml(wb, editable, wbRoundLabel, orderMap, currentMatchId);

  if (lb.length) {
    html += `<div class="stage-heading lb">LOSERS BRACKET 敗部</div>`;
    html += stageColumnsHtml(lb, editable, lbRoundLabel, orderMap, currentMatchId);
  }

  if (tp.length) {
    html += `<div class="stage-heading tp">THIRD PLACE MATCH 季軍賽</div>`;
    html += `<div class="bracket-scroll"><div class="bracket"><div class="bracket-col"><div class="col-label">季軍賽</div>${tp.map((m) => matchCardHtml(m, editable, orderMap, currentMatchId)).join('')}</div></div></div>`;
  }

  if (gf.length) {
    html += `<div class="stage-heading gf">GRAND FINAL 總決賽</div>`;
    html += `<div class="bracket-scroll"><div class="bracket">${gf
      .map(
        (m, i) =>
          `<div class="bracket-col"><div class="col-label">${m.isReset ? 'Reset Match' : '總決賽'}</div>${matchCardHtml(
            m,
            editable,
            orderMap,
            currentMatchId
          )}</div>`
      )
      .join('')}</div></div>`;
  }

  container.innerHTML = html;

  if (editable) {
    container.querySelectorAll('.match-card.clickable').forEach((el) => {
      el.addEventListener('click', () => opts.onRecord(el.dataset.matchId));
    });
  }
}

// ---------- 比分輸入 modal ----------
function openScoreModal(match, onSubmit, onQuickWinner) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask center';
  mask.innerHTML = `
    <div class="modal-sheet result-modal" style="position:relative;">
      <button class="modal-close" type="button" aria-label="關閉">✕</button>
      <h3>記錄比賽結果</h3>
      <div class="result-hint">快速記錄：直接按下勝者的「勝」即可完成比賽</div>
      <div class="winner-grid">
        <div class="winner-side">
          <div class="winner-player">${CX.esc(match.playerA)}</div>
          <button class="winner-big" id="cx-win-a" type="button" aria-label="${CX.esc(match.playerA)} 獲勝">
            <span class="winner-big-mark">勝</span>
            <span class="winner-big-text">${CX.esc(match.playerA)} 獲勝</span>
          </button>
          <div class="score-label">比分（可選）</div>
          <input class="score-small" type="number" inputmode="numeric" min="0" id="cx-score-a" value="" placeholder="—">
        </div>
        <div class="result-vs">VS</div>
        <div class="winner-side">
          <div class="winner-player">${CX.esc(match.playerB)}</div>
          <button class="winner-big" id="cx-win-b" type="button" aria-label="${CX.esc(match.playerB)} 獲勝">
            <span class="winner-big-mark">勝</span>
            <span class="winner-big-text">${CX.esc(match.playerB)} 獲勝</span>
          </button>
          <div class="score-label">比分（可選）</div>
          <input class="score-small" type="number" inputmode="numeric" min="0" id="cx-score-b" value="" placeholder="—">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cx-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="cx-submit" type="button">用比分完成</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.querySelector('.modal-close').addEventListener('click', close);
  mask.querySelector('#cx-cancel').addEventListener('click', close);

  const submitWinner = async (winnerSlot) => {
    try {
      if (typeof onQuickWinner !== 'function') throw new Error('快速判勝功能尚未載入，請重新整理頁面後再試');
      const btn = mask.querySelector(winnerSlot === 'A' ? '#cx-win-a' : '#cx-win-b');
      btn.disabled = true;
      await onQuickWinner(winnerSlot);
      close();
    } catch (e) {
      const btn = mask.querySelector(winnerSlot === 'A' ? '#cx-win-a' : '#cx-win-b');
      if (btn) btn.disabled = false;
      CX.toast(e.message || '記錄比賽失敗');
    }
  };

  mask.querySelector('#cx-win-a').addEventListener('click', () => submitWinner('A'));
  mask.querySelector('#cx-win-b').addEventListener('click', () => submitWinner('B'));

  mask.querySelector('#cx-submit').addEventListener('click', async () => {
    const aInput = mask.querySelector('#cx-score-a').value;
    const bInput = mask.querySelector('#cx-score-b').value;
    const a = Number(aInput);
    const b = Number(bInput);
    if (aInput === '' || bInput === '' || Number.isNaN(a) || Number.isNaN(b) || a === b) {
      CX.toast('請輸入兩邊不同的比分，或直接按下勝者的「勝」');
      return;
    }
    try {
      await onSubmit(a, b);
      close();
    } catch (e) {
      CX.toast(e.message || '記錄比賽失敗');
    }
  });
}

window.CXBracket = { renderBracket, openScoreModal, playerLabel };
