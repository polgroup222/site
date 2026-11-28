'use strict';
// Три агенти-помічники власника (погоджено 28.11.2026). Нічого не видаляють, нічого не витрачають, клієнту нічого не надсилають.
// 1. Контроль замовлень: перед рендером перевіряє оплату, фото (обличчя, розмір, різкість) та ім'я.
//    Підозріле замовлення отримує статус «hold» і чекає кнопки «OK» в адмінці.
// 2. Перевірка готового відео: після рендеру порівнює ролик з мастером (tools/video_check.py), кадри книги й портрета — в адмінку.
// 3. Сторож сервера: tools/watchdog.py на самому сервері (cron, кожні 10 хв) пише /data/watchdog.json; тут лише показуємо.
// Повідомлення: блок «Проблеми» в адмінці + Telegram (TG_BOT_TOKEN, TG_CHAT_ID у .env). Ранкова зведення о 08:00.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV = process.env;

// людські назви для кодів перевірок
const LABELS = {
  not_paid: 'оплата не підтверджена', photo_missing: 'фото не знайдено', photo_unreadable: 'фото не відкривається',
  photo_too_small: 'фото замале (менше 600 px)', face_not_found: 'на фото не знайдено обличчя', several_faces: 'на фото кілька облич',
  face_too_small: 'обличчя на фото задрібне', face_too_dark: 'обличчя затемнене', photo_too_dark: 'фото дуже темне',
  photo_too_bright: 'фото пересвічене', photo_blurry: 'фото розмите', photo_slightly_soft: 'фото трохи м’яке',
  face_small_in_photo: 'обличчя невелике, портрет буде крупним планом', name_not_in_dictionary: "ім'я нове, немає в словнику",
  vocative_uncertain: 'не впевнені в кличному відмінку', name_does_not_fit: "ім'я не влазить у книгу", voice_stub: 'голос-заглушка (без ElevenLabs)',
  crop_low_resolution: 'обрізане фото малої роздільності', portrait_overlay_failed: 'не вдалося вставити фото в портрет',
  check_failed: 'перевірка не спрацювала',
};
const label = (k) => LABELS[k] || LABELS[String(k).replace(/_[\d.]+.*$/, '')] || k;

function runJson(cmd, args, timeoutMs) {
  return new Promise((ok) => {
    const ch = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => ch.kill('SIGKILL'), timeoutMs);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { err += d; if (err.length > 1e5) err = err.slice(-5e4); });
    ch.on('error', e => { clearTimeout(t); ok({ error: e.message }); });
    ch.on('close', code => {
      clearTimeout(t);
      try { ok(JSON.parse(out.trim().split('\n').pop())); } catch { ok({ error: `exit ${code}: ${err.slice(-400)}` }); }
    });
  });
}

// ---------- Telegram ----------
function tg(text) {
  if (!ENV.TG_BOT_TOKEN || !ENV.TG_CHAT_ID) return Promise.resolve(false);
  return fetch(`https://api.telegram.org/bot${ENV.TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ENV.TG_CHAT_ID, text: String(text).slice(0, 3900), disable_web_page_preview: true }) })
    .then(r => r.ok).catch(e => { console.error('tg', e.message); return false; });
}

// ---------- 1. контроль замовлення ----------
async function checkOrder(o, odir, { paymentMode }) {
  const problems = [], notes = [];
  if (!o.paidAt && paymentMode !== 'none') problems.push('not_paid');
  let photo = null;
  const f = o.photo && path.join(odir, o.photo);
  if (!f || !fs.existsSync(f)) problems.push('photo_missing');
  else {
    photo = await runJson('python3', [path.join(ROOT, 'tools', 'photo_check.py'), f], 60e3);
    if (photo.error) notes.push('check_failed');
    problems.push(...(photo.problems || [])); notes.push(...(photo.notes || []));
  }
  problems.push(...(o.nameCheck || []));
  return { at: new Date().toISOString(), ok: problems.length === 0, problems: [...new Set(problems)], notes, photo };
}

// ---------- 2. перевірка готового відео ----------
async function checkVideo({ masterJson, masterVideo, video, outDir, voiceDur }) {
  const r = await runJson('python3', [path.join(ROOT, 'tools', 'video_check.py'), masterJson, masterVideo, video, outDir, String(voiceDur || '')], 15 * 60e3);
  if (r.error) return { at: new Date().toISOString(), ok: false, checks: [{ key: 'check_failed', ok: false, label: 'Перевірка відео не спрацювала', detail: r.error.slice(0, 300) }], frames: {} };
  return { at: new Date().toISOString(), ...r };
}
const qcFails = (qc) => (qc?.checks || []).filter(c => !c.ok);

// ---------- 3. сторож (стан пише tools/watchdog.py) ----------
function watchdogState(dataDir) {
  try {
    const w = JSON.parse(fs.readFileSync(path.join(dataDir, 'watchdog.json'), 'utf8'));
    const ageMin = (Date.now() - Date.parse(w.ts)) / 60e3;
    if (ageMin > 30) return { ...w, stale: true, ageMin: Math.round(ageMin) };
    return { ...w, ageMin: Math.round(ageMin) };
  } catch { return null; }
}

// усе, що зараз потребує уваги власника (для блоку «Проблеми» і ранкової зведення)
function problemsNow(orders, dataDir) {
  const p = [];
  const w = watchdogState(dataDir);
  if (!w) p.push({ kind: 'server', text: 'Сторож сервера ще не запускався (немає watchdog.json)' });
  else if (w.stale) p.push({ kind: 'server', text: `Сторож сервера не звітує вже ${w.ageMin} хв` });
  else for (const c of w.checks || []) if (!c.ok) p.push({ kind: 'server', text: `${c.label}: ${c.detail || ''}` });
  for (const o of orders) {
    if (o.test) continue;
    if (o.status === 'hold') p.push({ kind: 'order', o, text: `Чекає вашого OK: ${(o.check?.problems || []).map(label).join(', ')}` });
    else if (o.status === 'review' && qcFails(o.qc).length) p.push({ kind: 'order', o, text: `Відео з зауваженнями: ${qcFails(o.qc).map(c => c.label).join(', ')}` });
    else if (o.status === 'failed') p.push({ kind: 'order', o, text: 'Рендер не вдався' });
  }
  return p;
}

// ---------- ранкова зведення о 08:00 (час власника) ----------
const TZ = ENV.OWNER_TZ || 'Europe/Kiev';
const localParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  .formatToParts(d).map(x => [x.type, x.value]));
function morningText(orders, dataDir, publicUrl) {
  const all = orders.filter(o => !o.test), dayAgo = Date.now() - 864e5;
  const recent = all.filter(o => Date.parse(o.createdAt) > dayAgo);
  const paid = all.filter(o => o.paidAt && Date.parse(o.paidAt) > dayAgo), sent = all.filter(o => o.sentAt && Date.parse(o.sentAt) > dayAgo);
  const money = paid.reduce((a, o) => a + (Number(o.amount) || 0), 0);
  const by = (s) => all.filter(o => o.status === s);
  const oldUnpaid = by('awaiting_payment').filter(o => Date.parse(o.createdAt) < dayAgo);
  const line = (o) => `  • ${o.no} ${o.childName}`;
  const pr = problemsNow(orders, dataDir);
  return [`☀️ Доброго ранку! Čestitam за останню добу`,
    `Нових замовлень: ${recent.length}, оплачено: ${paid.length}${money ? ` (${money})` : ''}, надіслано клієнтам: ${sent.length}`,
    by('hold').length ? `⏸ Чекають вашого OK (${by('hold').length}):\n${by('hold').map(o => line(o) + ' — ' + (o.check?.problems || []).map(label).join(', ')).join('\n')}` : '',
    by('review').length ? `🎬 Готові, чекають перевірки (${by('review').length}):\n${by('review').map(o => line(o) + (qcFails(o.qc).length ? ' — ⚠️ ' + qcFails(o.qc).map(c => c.label).join(', ') : ' — ✓ перевірка пройдена')).join('\n')}` : '',
    by('failed').length ? `❌ Рендер не вдався (${by('failed').length}):\n${by('failed').map(line).join('\n')}` : '',
    oldUnpaid.length ? `💤 Не оплачені понад добу: ${oldUnpaid.length}` : '',
    by('queued').length + by('rendering').length ? `У черзі / рендер: ${by('queued').length + by('rendering').length}` : '',
    pr.filter(x => x.kind === 'server').length ? `🖥 Сервер:\n${pr.filter(x => x.kind === 'server').map(x => '  • ' + x.text).join('\n')}` : '🖥 Сервер: усе гаразд',
    `${publicUrl}/admin`].filter(Boolean).join('\n\n');
}
function startMorning({ listOrders, dataDir, publicUrl }) {
  const stFile = path.join(dataDir, 'agents_state.json');
  const st = () => { try { return JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch { return {}; } };
  const hour = Number(ENV.SUMMARY_HOUR ?? 8);
  setInterval(async () => {
    const p = localParts(), day = `${p.year}-${p.month}-${p.day}`;
    if (Number(p.hour) !== hour || st().summaryDay === day) return;
    fs.writeFileSync(stFile, JSON.stringify({ ...st(), summaryDay: day }));
    await tg(morningText(listOrders(), dataDir, publicUrl));
  }, 60e3);
}

module.exports = { checkOrder, checkVideo, qcFails, problemsNow, watchdogState, morningText, startMorning, tg, label };
