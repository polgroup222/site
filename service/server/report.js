'use strict';
// Агент «Звіт» (погоджено 28.11.2026): щодня о 21:00 за Києвом збирає звіт за день і зберігає runtime/reports/РРРР-ММ-ДД.json.
// Показується лише на сторінці «Мої агенти» (у Telegram не надсилається). Нічого не витрачає.
// Також тримає Google-таблицю оплачених замовлень (SHEET_WEBHOOK, див. tools/google-sheet.gs).
const fs = require('fs');
const path = require('path');
const { localParts, localDay, readEvents, qcFails, label } = require('./agents');

const ENV = process.env;
const STU = { awaiting_payment: 'Чекає оплату', hold: 'Чекає вашого OK', queued: 'У черзі', rendering: 'Рендер', review: 'На перевірці', sent: 'Надіслано', failed: 'Помилка', rejected: 'Скасовано', payment_failed: 'Оплата не пройшла' };
const dayOf = (ts) => ts ? localDay(new Date(ts)) : null;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => a.length ? sum(a) / a.length : null;
const shiftDay = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function buildReport(day, orders, dataDir) {
  const all = orders.filter(o => !o.test);
  const created = all.filter(o => dayOf(o.createdAt) === day);
  const paid = all.filter(o => dayOf(o.paidAt) === day);
  const sent = all.filter(o => dayOf(o.sentAt) === day);
  const money = sum(paid.map(o => Number(o.amount) || 0));
  const ready = (o) => !!(o.qc || ['review', 'sent'].includes(o.status));
  const ev = readEvents(dataDir, 9).filter(e => !e.test && dayOf(e.ts) === day);
  const of = (k) => ev.filter(e => e.agent === k);
  const dayAgo = Date.now() - 864e5;
  const st = (s) => all.filter(o => o.status === s);
  const toReady = paid.filter(o => o.qc?.at).map(o => (Date.parse(o.qc.at) - Date.parse(o.paidAt)) / 60e3).filter(x => x > 0);
  const renders = all.filter(o => dayOf(o.qc?.at) === day && o.result?.renderSeconds).map(o => o.result.renderSeconds / 60);
  const link = (o) => ({ no: o.no, name: o.childName, id: o.id });
  return {
    day, generatedAt: new Date().toISOString(),
    main: { created: created.length, paid: paid.length, money, sent: sent.length, avgCheck: paid.length ? Math.round(money / paid.length) : 0 },
    funnel: { created: created.length, paid: created.filter(o => o.paidAt).length, ready: created.filter(ready).length, sent: created.filter(o => o.sentAt).length },
    stuck: {
      hold: st('hold').map(o => ({ ...link(o), why: (o.check?.problems || []).map(label).join(', ') })),
      review: st('review').map(o => ({ ...link(o), why: qcFails(o.qc).length ? 'зауваження: ' + qcFails(o.qc).map(c => c.label).join(', ') : 'перевірка пройдена, чекає вашого підтвердження' })),
      failed: st('failed').map(o => ({ ...link(o), why: 'рендер не вдався' })),
      unpaid: st('awaiting_payment').filter(o => Date.parse(o.createdAt) < dayAgo).map(o => ({ ...link(o), why: 'не оплачено понад добу' })),
    },
    agents: {
      ordersChecked: of('orders').filter(e => 'problems' in e).length, ordersHeld: of('orders').filter(e => e.hold).length,
      videosChecked: of('video').length, videoIssues: of('video').filter(e => !e.ok).map(e => ({ no: e.no, name: e.name, fails: e.fails || [] })),
      alarms: of('watchdog').filter(e => !e.ok).map(e => ({ ts: e.ts, msg: e.msg })),
    },
    speed: { payToReadyMin: toReady.length ? Math.round(avg(toReady)) : null, renderMin: renders.length ? Math.round(avg(renders) * 10) / 10 : null },
    orders: [...new Map([...created, ...paid, ...sent].map(o => [o.id, o])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(o => ({ ...link(o), status: STU[o.status] || o.status, amount: Number(o.amount) || 0, createdAt: o.createdAt })),
  };
}

const RDIR = (dataDir) => path.join(dataDir, 'reports');
function savedDays(dataDir) {
  try { return fs.readdirSync(RDIR(dataDir)).filter(f => /^\d{4}-\d\d-\d\d\.json$/.test(f)).map(f => f.slice(0, 10)).sort().reverse(); } catch { return []; }
}
function loadSaved(dataDir, day) { try { return JSON.parse(fs.readFileSync(path.join(RDIR(dataDir), day + '.json'), 'utf8')); } catch { return null; } }
function saveReport(dataDir, r) {
  fs.mkdirSync(RDIR(dataDir), { recursive: true });
  const f = path.join(RDIR(dataDir), r.day + '.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 1)); fs.renameSync(f + '.tmp', f);
}

// відповідь для сторінки: обраний день (збережений о 21:00 або «поки що» для сьогодні), вчора для порівняння, 7 днів для графіка
function reportFeed(dataDir, orders, dayReq) {
  const today = localDay(new Date());
  const day = /^\d{4}-\d\d-\d\d$/.test(dayReq || '') ? dayReq : today;   // за замовчуванням сьогодні (до 21:00 — «поки що»)
  const saved = loadSaved(dataDir, day);
  const report = saved || buildReport(day, orders, dataDir);
  const prevDay = shiftDay(day, -1);
  const prev = loadSaved(dataDir, prevDay) || buildReport(prevDay, orders, dataDir);
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(day, -i), r = d === day ? report : (loadSaved(dataDir, d) || buildReport(d, orders, dataDir));
    week.push({ day: d, paid: r.main.paid, money: r.main.money, created: r.main.created });
  }
  return { day, today, live: !saved, days: [...new Set([today, ...savedDays(dataDir)])].sort().reverse().slice(0, 60), report, prev: prev.main, week };
}

// ---------- Google-таблиця оплачених замовлень ----------
// значення, що починаються з = + - @, Google-таблиця вважає формулою (через неї можна витягнути дані): ставимо ' попереду
const cell = (v) => typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
const sheetRow = (o) => Object.fromEntries(Object.entries({ no: o.no, createdAt: o.createdAt, paidAt: o.paidAt || '', childName: o.childName, email: o.email || '', lang: o.lang,
  amount: o.amount ?? '', payMethod: o.payMethod || '', status: STU[o.status] || o.status, sentAt: o.sentAt || '', note: o.note || '',
  phone: o.phone ? '+' + o.phone : '' }).map(([k, v]) => [k, cell(v)]));   // телефон +381… теж як текст
const sheetSeen = new Map();   // no -> останній надісланий рядок, щоб не слати те саме
async function sheetPush(rows, event) {
  if (!ENV.SHEET_WEBHOOK || !rows.length) return { ok: false, skipped: true };
  try {
    const r = await fetch(ENV.SHEET_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ secret: ENV.SHEET_SECRET || '', rows }) });
    const ok = r.ok && /"ok"\s*:\s*true/.test(await r.text());
    if (ok) for (const x of rows) sheetSeen.set(x.no, JSON.stringify(x));
    if (!ok) event?.({ agent: 'report', ok: false, msg: `Google-таблиця: не вдалося записати (${r.status})` });
    return { ok };
  } catch (e) { event?.({ agent: 'report', ok: false, msg: 'Google-таблиця: ' + e.message }); return { ok: false }; }
}
// викликається після кожного збереження замовлення: лише оплачені, лише якщо щось змінилось
function sheetSync(o, event) {
  if (o.test || !o.paidAt || !ENV.SHEET_WEBHOOK) return;
  const row = sheetRow(o); if (sheetSeen.get(o.no) === JSON.stringify(row)) return;
  sheetPush([row], event);
}

function startReport({ listOrders, dataDir, event }) {
  const stFile = path.join(dataDir, 'agents_state.json');
  const st = () => { try { return JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch { return {}; } };
  const hour = Number(ENV.REPORT_HOUR ?? 21);
  setInterval(async () => {
    const p = localParts(), day = `${p.year}-${p.month}-${p.day}`;
    if (Number(p.hour) !== hour || st().reportDay === day) return;
    fs.writeFileSync(stFile, JSON.stringify({ ...st(), reportDay: day }));
    const orders = listOrders();
    const r = buildReport(day, orders, dataDir); saveReport(dataDir, r);
    event({ agent: 'report', ok: true, msg: `звіт за ${day}: замовлень ${r.main.created}, оплачено ${r.main.paid}, виручка ${r.main.money}` });
    // раз на день повністю звіряємо Google-таблицю (якщо щось не дійшло вдень)
    const paid = orders.filter(o => !o.test && o.paidAt).map(sheetRow);
    if (paid.length && ENV.SHEET_WEBHOOK) { const res = await sheetPush(paid, event); if (res.ok) event({ agent: 'report', ok: true, msg: `Google-таблиця звірена: ${paid.length} оплачених замовлень` }); }
  }, 60e3);
}

module.exports = { buildReport, reportFeed, saveReport, startReport, sheetSync, sheetPush, sheetRow };
