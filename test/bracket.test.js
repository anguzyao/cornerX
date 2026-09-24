const { createBracket, recordResult } = require('../src/bracket');

function playOut(data) {
  let guard = 0;
  while (!data.champion && guard < 500) {
    guard++;
    const ready = data.matches.find((m) => m.status === 'ready');
    if (!ready) break;
    // A 固定贏，方便觀察流程；分數隨便給
    recordResult(data, ready.id, 2, 1);
  }
  return data;
}

function summarize(label, n, format) {
  const players = Array.from({ length: n }, (_, i) => 'P' + (i + 1));
  const data = createBracket(players, format);
  playOut(data);
  const doneCount = data.matches.filter((m) => m.status === 'done').length;
  console.log(
    `${label} n=${n} format=${format} -> matches=${data.matches.length} done=${doneCount} champion=${data.champion} runnerUp=${data.runnerUp}`
  );
  if (!data.champion) {
    console.error('  !! 沒有產生冠軍，流程有問題');
    console.dir(data.matches, { depth: null });
    process.exitCode = 1;
  }
  // 檢查是否有比賽卡在雙方都有人卻沒完成
  const stuck = data.matches.filter((m) => m.status !== 'done' && m.playerA && m.playerB && m.playerA !== '__BYE__' && m.playerB !== '__BYE__');
  if (stuck.length) {
    console.error('  !! 有比賽卡住:', stuck.map((m) => m.id));
    process.exitCode = 1;
  }
}

for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 16]) {
  summarize('single', n, 'single');
}
for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 16]) {
  summarize('double', n, 'double');
}

console.log('DONE');
