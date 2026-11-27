'use strict';
// Окремий процес для рендеру: важкі ffmpeg/Python виклики не блокують HTTP-сервер.
// Отримує параметри замовлення як JSON у stdin, друкує результат як JSON у останньому рядку stdout.
const { renderMaster } = require('../src/render-master');
let buf = '';
process.stdin.on('data', c => { buf += c; });
process.stdin.on('end', async () => {
  try {
    const r = await renderMaster(JSON.parse(buf));
    process.stdout.write('\n' + JSON.stringify({ ok: true, r }) + '\n');
  } catch (e) {
    process.stdout.write('\n' + JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 4000) }) + '\n');
  }
});
