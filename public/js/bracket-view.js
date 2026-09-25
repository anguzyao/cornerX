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

function matchCardHtml(m, editable) {
  const rows = ['A', 'B'].map((slot) => {
    const name = slot === 'A' ? m.playerA : m.playerB;
    const score = slot === 'A' ? m.scoreA : m.scoreB;
    const isWinner = m.status === 'done' && m.winner === name && name !== BYE;
    const isBye = name === BYE;
    const cls = ['match-row', isWinner ? 'winner' : '', isBye ? 'bye' : ''].filter(Boolean).join(' ');
    const scoreHtml = m.status === 'done' && score !== null && score !== undefined ? `<span class="pscore">${score}</span>` : '';
    return `<div class="${cls}"><span class="pname">${CX.esc(playerLabel(name))}</span>${scoreHtml}</div>`;
  });
  const clickable = editable && m.status === 'ready';
  const cls = ['match-card', clickable ? 'clickable' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-match-id="${m.id}">${rows.join('')}</div>`;
}

function stageColumnsHtml(matchesInStage, editable, roundLabelFn) {
  const cols = groupByRound(matchesInStage);
  return `<div class="bracket-scroll"><div class="bracket">${cols
    .map((col, i) => {
      const connect = i < cols.length - 1 ? 'connect' : '';
      return `<div class="bracket-col ${connect}"><div class="col-label">${roundLabelFn(col[0].round, cols.length)}</div>${col
        .map((m) => matchCardHtml(m, editable))
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
  const wb = matches.filter((m) => m.stage === 'WB');
  const lb = matches.filter((m) => m.stage === 'LB');
  const gf = matches.filter((m) => m.stage === 'GF').sort((a, b) => a.round - b.round);

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

  html += `<div class="stage-heading wb">${lb.length ? 'WINNERS BRACKET 勝部' : '賽程 BRACKET'}</div>`;
  html += stageColumnsHtml(wb, editable, wbRoundLabel);

  if (lb.length) {
    html += `<div class="stage-heading lb">LOSERS BRACKET 敗部</div>`;
    html += stageColumnsHtml(lb, editable, lbRoundLabel);
  }

  if (gf.length) {
    html += `<div class="stage-heading gf">GRAND FINAL 總決賽</div>`;
    html += `<div class="bracket-scroll"><div class="bracket">${gf
      .map(
        (m, i) =>
          `<div class="bracket-col"><div class="col-label">${m.isReset ? 'Reset Match' : '總決賽'}</div>${matchCardHtml(
            m,
            editable
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
function openScoreModal(match, onSubmit) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask center';
  mask.innerHTML = `
    <div class="modal-sheet" style="position:relative;">
      <span class="modal-close">✕</span>
      <h3>記錄比賽結果</h3>
      <div class="modal-vs">
        <div class="side">
          <div class="pname">${CX.esc(match.playerA)}</div>
          <input type="number" inputmode="numeric" min="0" id="cx-score-a" value="">
        </div>
        <div class="vs-mid">VS</div>
        <div class="side">
          <div class="pname">${CX.esc(match.playerB)}</div>
          <input type="number" inputmode="numeric" min="0" id="cx-score-b" value="">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cx-cancel">取消</button>
        <button class="btn btn-primary" id="cx-submit">完成比賽</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.querySelector('.modal-close').addEventListener('click', close);
  mask.querySelector('#cx-cancel').addEventListener('click', close);
  mask.querySelector('#cx-submit').addEventListener('click', async () => {
    const a = Number(mask.querySelector('#cx-score-a').value);
    const b = Number(mask.querySelector('#cx-score-b').value);
    if (Number.isNaN(a) || Number.isNaN(b) || a === b) {
      CX.toast('請輸入不同的比分');
      return;
    }
    try {
      await onSubmit(a, b);
      close();
    } catch (e) {
      CX.toast(e.message || '發生錯誤');
    }
  });
}

window.CXBracket = { renderBracket, openScoreModal, playerLabel };
