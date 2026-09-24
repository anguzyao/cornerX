// leaderboard-view.js — 畫出排行榜列表
// 依賴 app.js (CX)

function medalFor(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function changeArrow(change) {
  if (change === 'up') return '<span class="lb-change up">▲</span>';
  if (change === 'down') return '<span class="lb-change down">▼</span>';
  return '<span class="lb-change">—</span>';
}

// 唯讀顯示（公開分享頁 / 管理頁上方總覽都可用）
function renderLeaderboardView(container, entries) {
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state"><div class="big">🏁</div>尚未有任何積分紀錄</div>`;
    return;
  }
  container.innerHTML = entries
    .map((e) => {
      const topCls = e.rank <= 4 ? `top${e.rank}` : '';
      return `<div class="lb-row ${topCls}">
        <div class="lb-rank"><span class="rank-num">${medalFor(e.rank)}</span></div>
        <div class="lb-name">${CX.esc(e.name)}</div>
        <div class="lb-score num">${e.score}</div>
        ${changeArrow(e.change)}
      </div>`;
    })
    .join('');
}

// 可編輯列表（排行榜管理頁）：姓名可改、分數用 +/- 或直接輸入、可刪除
function renderLeaderboardEdit(container, entries, handlers) {
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state"><div class="big">🏁</div>還沒有參賽者，新增一位開始吧</div>`;
    return;
  }
  container.innerHTML = entries
    .map(
      (e) => `<div class="lb-edit-row" data-id="${e.id}">
        <div style="width:26px;text-align:center;flex-shrink:0;">${medalFor(e.rank)}</div>
        <input class="lb-name-input" data-role="name" value="${CX.esc(e.name)}" />
        <div class="stepper">
          <button data-role="minus">−</button>
          <input class="score-input" data-role="score" type="number" value="${e.score}" />
          <button data-role="plus">＋</button>
        </div>
        <div class="remove-x" data-role="remove">✕</div>
      </div>`
    )
    .join('');

  container.querySelectorAll('.lb-edit-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-role=minus]').addEventListener('click', () => handlers.onAdjust(id, -1));
    row.querySelector('[data-role=plus]').addEventListener('click', () => handlers.onAdjust(id, 1));
    const scoreInput = row.querySelector('[data-role=score]');
    scoreInput.addEventListener('change', () => handlers.onSetScore(id, Number(scoreInput.value) || 0));
    const nameInput = row.querySelector('[data-role=name]');
    nameInput.addEventListener('change', () => handlers.onRename(id, nameInput.value));
    row.querySelector('[data-role=remove]').addEventListener('click', () => handlers.onRemove(id));
  });
}

window.CXLeaderboard = { renderLeaderboardView, renderLeaderboardEdit, medalFor };
