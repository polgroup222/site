'use strict';
// Сервер замовлень: прийом (ім'я + фото + email) -> черга -> рендер -> перевірка -> лист клієнту з посиланням.
// Без зовнішніх залежностей: лише Node 18+, ffmpeg, ImageMagick, Python (див. Dockerfile).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveName } = require('../src/names');
const { spawn } = require('child_process');
// рендер у дочірньому процесі: сервер лишається чуйним, поки йде ffmpeg
function renderInChild(job) {
  return new Promise((ok, fail) => {
    const ch = spawn(process.execPath, [path.join(__dirname, 'render-job.js')], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
    let out = '';
    ch.stdout.on('data', d => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    ch.on('error', fail);
    ch.on('close', code => {
      const line = out.trim().split('\n').pop();
      let j; try { j = JSON.parse(line); } catch { return fail(new Error(`render-job exit ${code}`)); }
      j.ok ? ok(j.r) : fail(new Error(j.error));
    });
    ch.stdin.end(JSON.stringify(job));
  });
}

const ENV = process.env;
const PORT = Number(ENV.PORT || 8080);
const DATA = ENV.DATA_DIR || path.join(__dirname, '..', 'data_runtime');
const ORDERS = path.join(DATA, 'orders');
const MASTER = ENV.MASTER_JSON || path.join(__dirname, '..', 'master', 'master.json');
const PUBLIC_URL = (ENV.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_TOKEN = ENV.ADMIN_TOKEN || '';
const ORIGINS = (ENV.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const PAYMENT_MODE = ENV.PAYMENT_MODE || 'manual';      // manual: адмін позначає «оплачено»; none: одразу в чергу
const AUTO_SEND = ENV.AUTO_SEND === '1';                 // 1: ролик без зауважень іде клієнту без ручної перевірки
const MAX_PHOTO = 12 << 20;
const KEEP_PHOTO_DAYS = Number(ENV.KEEP_PHOTO_DAYS || 30);   // фото дитини видаляємо через N днів після відправки
const KEEP_VIDEO_DAYS = Number(ENV.KEEP_VIDEO_DAYS || 60);   // відео — через N днів
const AVG_RENDER_MIN = 8;
fs.mkdirSync(ORDERS, { recursive: true });
if (!ADMIN_TOKEN) console.warn('[warn] ADMIN_TOKEN не задано: адмінка вимкнена');

// ---------- сховище ----------
const odir = (id) => path.join(ORDERS, id);
const load = (id) => { try { return JSON.parse(fs.readFileSync(path.join(odir(id), 'order.json'), 'utf8')); } catch { return null; } };
function save(o) {
  o.updatedAt = new Date().toISOString();
  const f = path.join(odir(o.id), 'order.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f);
}
const listOrders = () => fs.readdirSync(ORDERS).map(load).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
// короткий номер замовлення для клієнта (6 цифр, унікальний): вхід на /porudzbina = email + номер
// номер замовлення по порядку: CT-00001, CT-00002 … (seq — число, no — те, що бачить клієнт)
const NO_PREFIX = 'CT-';
const fmtNo = (n) => NO_PREFIX + String(n).padStart(5, '0');
let lastSeq = 0;
function newNo() { lastSeq += 1; return { seq: lastSeq, no: fmtNo(lastSeq) }; }
// журнал: історія в самому замовленні + загальний файл подій за день (logs/РРРР-ММ-ДД.jsonl), нічого не видаляється
const LOGS = path.join(DATA, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
function event(rec) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(path.join(LOGS, ts.slice(0, 10) + '.jsonl'), JSON.stringify({ ts, ...rec }) + '\n'); } catch (e) { console.error('log', e.message); }
}
const log = (o, msg) => { const ts = new Date().toISOString(); (o.log ||= []).push(`${ts} ${msg}`);
  event({ order: o.id, name: o.childName, email: o.email, status: o.status, msg }); };

// ---------- HTTP-допоміжні ----------
function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body), isStr = typeof body === 'string';
  res.writeHead(code, { 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(isBuf || isStr ? body : JSON.stringify(body));
}
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
function readBody(req, limit) {
  return new Promise((ok, fail) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { fail(Object.assign(new Error('too_large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', fail);
  });
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('adm='));
  return !!c && safeEq(c.slice(4), crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex'));
}
// простий ліміт: 5 замовлень на IP за 10 хв
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 600e3);
  arr.push(now); hits.set(ip, arr); return arr.length > 5;
}
const loginHits = new Map();
function loginLimited(k) {   // не більше 5 спроб за 10 хв на IP і окремо на email
  const now = Date.now(), arr = (loginHits.get(k) || []).filter(t => now - t < 600e3);
  arr.push(now); loginHits.set(k, arr); if (loginHits.size > 5000) loginHits.clear(); return arr.length > 5;
}
function photoExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(4, 12).toString().match(/ftyp(heic|heix|mif1|msf1|hevc)/)) return 'heic';
  return null;
}

// ---------- лист клієнту (Resend, якщо є ключ) ----------
const T = {
  'sr-Latn': { subj: 'Vaša čestitka od Deda Mraza je spremna ✦', body: (n, u, no) => `Zdravo!\n\nČestitka za ${n} je spremna. Pogledajte i preuzmite je ovde:\n${u}\n\nBroj porudžbine: ${no}\nStranici možete pristupiti i preko cestitam.eu/porudzbina (email + broj porudžbine).\n\nSrećni praznici!\nČestitam · cestitam.eu` },
  'sr-Cyrl': { subj: 'Ваша честитка од Деда Мраза је спремна ✦', body: (n, u, no) => `Здраво!\n\nЧеститка за ${n} је спремна. Погледајте и преузмите је овде:\n${u}\n\nБрој поруџбине: ${no}\nСтраници можете приступити и преко cestitam.eu/porudzbina (email + број поруџбине).\n\nСрећни празници!\nЧеститам · cestitam.eu` },
  uk: { subj: 'Ваше відеопривітання готове ✦', body: (n, u, no) => `Вітаємо!\n\nПривітання для ${n} готове. Переглянути і завантажити:\n${u}\n\nНомер замовлення: ${no}\nСторінку можна відкрити й через cestitam.eu/porudzbina (email + номер замовлення).\n\nЗі святами!\nČestitam · cestitam.eu` },
};
async function emailCustomer(o) {
  const url = `${PUBLIC_URL}/o/${o.id}/${o.key}`;
  if (!ENV.RESEND_API_KEY || !ENV.MAIL_FROM) { log(o, `email: ключа нема, посилання для ручної відправки ${url}`); return false; }
  const t = T[o.lang] || T['sr-Latn'];
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: ENV.MAIL_FROM, to: [o.email], subject: t.subj, text: t.body(o.childName, url, o.no) }) });
  log(o, `email ${r.ok ? 'надіслано' : 'помилка ' + r.status}`); return r.ok;
}

// ---------- Telegram: сповіщення власнику (TG_BOT_TOKEN + TG_CHAT_ID у .env) ----------
function notify(o, what) {
  if (!ENV.TG_BOT_TOKEN || !ENV.TG_CHAT_ID) return;
  const text = `${what}\n№ ${o.no || o.id} · ${o.childName} · ${o.email}\n${PUBLIC_URL}/admin?q=${o.no || o.id}`;
  fetch(`https://api.telegram.org/bot${ENV.TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ENV.TG_CHAT_ID, text, disable_web_page_preview: true }) }).catch(e => console.error('tg', e.message));
}

// ---------- воркер: одне замовлення за раз ----------
let busy = false;
async function tick() {
  if (busy) return;
  const o = listOrders().reverse().find(x => x.status === 'queued' && !x.test);   // тестові замовлення не рендеримо
  if (!o) return;
  busy = true;
  o.status = 'rendering'; o.attempts = (o.attempts || 0) + 1; log(o, 'рендер почато'); save(o);
  try {
    const r = await renderInChild({ id: 'video', name: o.childName, photo: path.join(odir(o.id), o.photo), master: MASTER,
      outDir: path.join(odir(o.id), 'out'), allowSpend: true, voiceFile: o.voiceFile });
    o.result = { status: r.status, reviewReasons: r.reviewReasons, renderSeconds: r.renderSeconds, voice: r.voice };
    o.video = 'out/video.mp4';
    // проміжні великі файли не тримаємо
    for (const f of ['portrait_overlay.mkv']) fs.rmSync(path.join(odir(o.id), 'out', f), { force: true });
    if (r.status === 'done' && AUTO_SEND) { o.status = 'sent'; await emailCustomer(o); }
    else { o.status = 'review'; notify(o, '🎬 Відео готове, перевірте'); }
    log(o, `рендер готовий: ${r.status} ${r.reviewReasons.join(',')}`);
  } catch (e) {
    o.status = o.attempts >= 2 ? 'failed' : 'queued'; o.error = String(e.message || e).slice(0, 2000); if (o.status === 'failed') notify(o, '⚠️ Рендер не вдався'); log(o, 'помилка: ' + o.error.slice(0, 300));
  }
  save(o); busy = false; setImmediate(tick);
}
// старим замовленням присвоюємо короткий номер
{ const all = listOrders().reverse();   // від найпершого
  lastSeq = Math.max(0, ...all.map(o => o.seq || 0));
  for (const o of all) if (!o.seq) {
    if (o.no) o.noOld = o.no;   // старий 6-значний номер теж пускає на /porudzbina
    Object.assign(o, newNo()); log(o, `присвоєно номер ${o.no}`); save(o);
  } }
// після перезапуску: незавершені рендери повертаємо в чергу
for (const o of listOrders()) if (o.status === 'rendering') { o.status = 'queued'; log(o, 'перезапуск сервера'); save(o); }
setInterval(tick, 5000);

// ---------- приватність: автоматичне видалення ----------
const daysSince = (t) => t ? (Date.now() - Date.parse(t)) / 864e5 : 0;
function purge() {
  if (ENV.AUTO_PURGE === '0') return;   // власник погодив автовидалення (27.11): фото 30 днів, відео 60, неоплачені 7
  for (const o of listOrders()) {
    const d = odir(o.id), ref = o.sentAt || o.updatedAt;
    const done = ['sent', 'rejected', 'failed'].includes(o.status), stale = o.status === 'awaiting_payment' && daysSince(o.createdAt) > 7;
    if (!o.photoPurged && ((done && daysSince(ref) > KEEP_PHOTO_DAYS) || stale)) {
      for (const f of [o.photo, 'out/photo_ready.png', 'out/portrait_overlay.mkv']) if (f) fs.rmSync(path.join(d, f), { force: true });
      o.photoPurged = new Date().toISOString(); log(o, 'фото видалено (термін зберігання)'); save(o);
    }
    if (!o.videoPurged && done && daysSince(ref) > KEEP_VIDEO_DAYS) {
      fs.rmSync(path.join(d, 'out'), { recursive: true, force: true });
      o.videoPurged = new Date().toISOString(); log(o, 'відео видалено (термін зберігання)'); save(o);
    }
  }
}
setTimeout(purge, 60e3); setInterval(purge, 6 * 3600e3);

// ---------- сторінки ----------
const page = (title, inner, lang = 'sr-Latn') => `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f231b"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{--bg:#0f231b;--card:#173328;--line:#2b4a3d;--ink:#f7f1e6;--mut:#c9bfae;--gold:#f2c46d;--red:#c8453b}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:radial-gradient(1200px 600px at 80% -10%,#2a4b3c 0,transparent 60%),var(--bg);min-height:100vh}
main{max-width:860px;margin:auto;padding:20px 16px 64px}.top{display:flex;justify-content:space-between;align-items:center;padding:4px 0 24px}.logo{font-weight:700;letter-spacing:.02em;color:var(--gold)}
h1{font:600 clamp(30px,6vw,48px)/1.1 Georgia,"Times New Roman",serif;margin:8px 0 22px}h1 small{display:block;font:500 14px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.steps{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 18px;flex-wrap:wrap}.steps li{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);color:var(--mut);font-size:14px}
.steps li span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--line);font-size:12px}.steps li.done{color:var(--ink)}.steps li.done span{background:var(--gold);color:#1a1a1a}.steps li.now{border-color:var(--gold);color:var(--ink)}.steps li.now span{background:var(--red);color:#fff}
.card{background:linear-gradient(180deg,#1b3a2e,#152e24);border:1px solid var(--line);border-radius:22px;padding:18px;margin:14px 0;box-shadow:0 20px 60px #0006}
video{width:100%;border-radius:14px;background:#000;display:block}a{color:var(--gold)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 6px}.b{display:inline-flex;align-items:center;gap:6px;padding:12px 18px;border-radius:999px;background:var(--gold);color:#1d1a12;text-decoration:none;border:0;font:600 15px system-ui,sans-serif;cursor:pointer}
.b.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.muted{color:var(--mut);font-size:14px}.tag{padding:2px 8px;border-radius:8px;background:#0005;font-size:13px}form{display:inline}
.wait{text-align:center;padding:28px 8px}.big{font:600 22px/1.3 Georgia,serif;margin:6px 0}.flake{font-size:44px;color:var(--gold);animation:s 6s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.flake{animation:none}}
</style></head><body><main>${inner}</main></body></html>`;
const CT = {
  'sr-Latn': { title: 'Čestitka za', st: { awaiting_payment: 'Čeka uplatu', queued: 'U redu za izradu', rendering: 'Deda Mraz upravo snima', review: 'Proveravamo svaki detalj', sent: 'Spremno!', failed: 'Došlo je do greške, javićemo vam se', rejected: 'Otkazano', payment_failed: 'Plaćanje nije prošlo' },
    eta: (m) => `Otprilike još ${m} min. Stranica se sama osvežava.`, pay: 'Čim uplata bude potvrđena, počinjemo izradu.', mail: 'Poslaćemo vam i email kada bude spremno.',
    dl: 'Preuzmi video', share: 'Podeli', copy: 'Kopiraj link', copied: 'Link je kopiran', gone: 'Video je obrisan nakon isteka roka čuvanja.', keep: (d) => `Video čuvamo ${d} dana. Preuzmite ga na vreme.`, steps: ['Porudžbina', 'Izrada', 'Provera', 'Spremno'], no: 'Broj porudžbine' },
  uk: { title: 'Привітання для', st: { awaiting_payment: 'Чекаємо оплату', queued: 'У черзі', rendering: 'Дід Мороз записує привітання', review: 'Перевіряємо кожну деталь', sent: 'Готово!', failed: 'Сталася помилка, ми зв’яжемося з вами', rejected: 'Скасовано', payment_failed: 'Оплата не пройшла' },
    eta: (m) => `Приблизно ще ${m} хв. Сторінка оновлюється сама.`, pay: 'Щойно оплату підтвердимо, почнемо створення.', mail: 'Коли буде готово, ми також надішлемо лист.',
    dl: 'Завантажити відео', share: 'Поділитися', copy: 'Скопіювати посилання', copied: 'Посилання скопійовано', gone: 'Відео видалено після завершення терміну зберігання.', keep: (d) => `Відео зберігаємо ${d} днів. Завантажте його вчасно.`, steps: ['Замовлення', 'Створення', 'Перевірка', 'Готово'], no: 'Номер замовлення' },
};
CT['sr-Cyrl'] = CT['sr-Latn'];
const ST = CT['sr-Latn'].st;
function eta(o) {
  if (o.status === 'rendering') return Math.max(2, Math.round(AVG_RENDER_MIN - (Date.now() - Date.parse(o.updatedAt)) / 60e3));
  if (o.status !== 'queued') return null;
  const q = listOrders().filter(x => x.status === 'queued' && !x.test).reverse(); const pos = q.findIndex(x => x.id === o.id);
  return (pos + 1 + (busy ? 1 : 0)) * AVG_RENDER_MIN;
}
Object.assign(CT['sr-Latn'], {
  formed: 'Porudžbina je spremna za plaćanje', formedP: 'Proverite podatke i platite. Izrada počinje odmah posle uplate.',
  child: 'Ime deteta', email: 'Email', pay: 'Plati', payManual: 'Javićemo vam se sa uputstvom za plaćanje na ovaj email.',
  paidH: 'Plaćeno! Predajemo porudžbinu na izradu', makingH: 'Montiramo video za vas', makingP: 'Sačuvajte broj porudžbine i email: sa njima uvek možete otvoriti ovu stranicu na cestitam.eu/porudzbina.',
  failH: 'Plaćanje nije prošlo', failP: 'Novac nije skinut. Pokušajte ponovo: napravićemo novu porudžbinu sa novim brojem, sa istim imenom i fotografijom.', retry: 'Pokušaj ponovo',
  copy1: 'Kopiraj', copied1: 'Kopirano', test: 'TEST porudžbina: plaćanje je simulirano, video se ne pravi.' });
Object.assign(CT.uk, {
  formed: 'Заявку сформовано, залишилось оплатити', formedP: 'Перевірте дані й оплатіть. Створення починається одразу після оплати.',
  child: 'Ім’я дитини', email: 'Email', pay: 'Оплатити', payManual: 'Ми надішлемо інструкцію з оплати на цей email.',
  paidH: 'Оплачено! Передаємо замовлення в роботу', makingH: 'Монтуємо відео для вас', makingP: 'Збережіть номер замовлення та email: з ними ви завжди відкриєте цю сторінку на cestitam.eu/porudzbina.',
  failH: 'Оплата не пройшла', failP: 'Гроші не списано. Спробуйте ще раз: ми створимо нову заявку з новим номером, з тим самим ім’ям і фото.', retry: 'Спробувати ще раз',
  copy1: 'Копіювати', copied1: 'Скопійовано', test: 'ТЕСТОВЕ замовлення: оплата імітується, відео не створюється.' });
const canPay = (o) => o.test || PAYMENT_MODE === 'mock';   // Stripe підключимо тут же: PAYMENT_MODE=stripe
function customerPage(o, flash = '') {
  const t = CT[o.lang] || CT['sr-Latn'], ready = o.status === 'sent' && !o.videoPurged;
  const step = { awaiting_payment: 0, payment_failed: 0, queued: 1, rendering: 1, review: 2, sent: 4 }[o.status] ?? 0;
  const m = eta(o), base = `/o/${o.id}/${o.key}`;
  const steps = t.steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"><span>${i < step ? '✓' : i + 1}</span>${esc(s)}</li>`).join('');
  const row = (label, val, copy) => `<div class="kv"><span class="muted">${esc(label)}</span><b>${esc(val)}</b>${copy ? `<button class="b ghost cp" data-v="${esc(val)}">⧉ ${esc(t.copy1)}</button>` : ''}</div>`;
  const facts = (copy) => `<div class="facts">${row(t.no, o.no || o.id, copy)}${row(t.email, o.email, copy)}${row(t.child, o.childName)}</div>`;
  let body;
  if (ready) body = `<video controls playsinline preload="metadata" src="${base}/video.mp4"></video>
<div class="actions"><a class="b" href="${base}/video.mp4?dl=1">⬇ ${esc(t.dl)}</a><button class="b ghost" id="share">↗ ${esc(t.share)}</button><button class="b ghost" id="copy">⧉ ${esc(t.copy)}</button></div>
<p class="muted">${esc(t.keep(KEEP_VIDEO_DAYS))}</p>`;
  else if (o.videoPurged) body = `<p>${esc(t.gone)}</p>`;
  else if (o.status === 'awaiting_payment') body = `<p class="big">${esc(t.formed)}</p><p class="muted">${esc(t.formedP)}</p>${facts(false)}
${canPay(o) ? `<form method="post" action="${base}/pay"><button class="b wide">${esc(t.pay)}</button></form>` : `<p class="muted">${esc(t.payManual)}</p>`}`;
  else if (o.status === 'payment_failed') body = `<div class="wait"><div class="flake bad">!</div><p class="big">${esc(t.failH)}</p><p class="muted">${esc(t.failP)}</p></div>
<form method="post" action="${base}/retry"><button class="b wide red">${esc(t.retry)}</button></form>`;
  else if (['queued', 'rendering', 'review'].includes(o.status)) body = `<div class="wait"><div class="flake">❄</div>
${flash === 'paid' ? `<p class="ok">✓ ${esc(t.paidH)}</p>` : ''}<p class="big">${esc(t.makingH)}</p>${m && !o.test ? `<p class="muted">${esc(t.eta(m))}</p>` : ''}</div>
${facts(true)}<p class="muted">${esc(t.makingP)}</p><p class="muted">${esc(t.mail)}</p>`;
  else body = `<div class="wait"><p class="big">${esc(t.st[o.status] || o.status)}</p></div>${facts(true)}`;
  const live = ['queued', 'rendering', 'review'].includes(o.status) && !o.test;
  return page('Čestitam', `<style>.facts{display:grid;gap:8px;margin:16px 0}.kv{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:#0e211a}
.kv span{flex-basis:100%;font-size:13px}.kv b{font-size:19px;letter-spacing:.02em;overflow-wrap:anywhere;flex:1;min-width:0}.kv{row-gap:4px}.kv .b{padding:8px 14px;font-size:14px}.wide{width:100%;justify-content:center;padding:15px;font-size:17px}.red{background:var(--red);color:#fff}
.ok{color:var(--gold);font-weight:600;margin:0}.flake.bad{animation:none;color:var(--red);font:700 44px/1 Georgia,serif}.testb{border:1px dashed var(--gold);border-radius:12px;padding:8px 12px;color:var(--gold);font-size:14px}form{display:block}</style>
<header class="top"><a class="logo" href="/" style="text-decoration:none">✳ Čestitam</a></header>
${o.test ? `<p class="testb">${esc(t.test)}</p>` : ''}
<h1><small>${esc(t.title)}</small>${esc(o.childName)}</h1><ol class="steps">${steps}</ol><section class="card">${body}</section>
${live ? '<script nonce="r">setTimeout(()=>location.replace(location.pathname),30000)</script>' : ''}
<script nonce="r">document.querySelectorAll('.cp').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.v).then(()=>{b.textContent=${JSON.stringify('✓ ' + t.copied1)};setTimeout(()=>b.textContent=${JSON.stringify('⧉ ' + t.copy1)},1800)}));
${ready ? `const u=location.href.split('#')[0];document.getElementById('share').onclick=()=>navigator.share?navigator.share({title:document.title,url:u}).catch(()=>{}):navigator.clipboard.writeText(u);
document.getElementById('copy').onclick=e=>navigator.clipboard.writeText(u).then(()=>{e.target.textContent=${JSON.stringify('✓ ' + t.copied)}});` : ''}</script>`, o.lang);
}
// тимчасова сторінка оплати для тестових замовлень (до підключення Stripe): успіх або відмова
function mockCheckout(o) {
  const base = `/o/${o.id}/${o.key}`;
  return page('Test checkout', `<header class="top"><span class="logo">Test checkout</span></header><section class="card"><p class="big">${esc(o.no)} · ${esc(o.childName)}</p>
<p class="muted">Імітація платіжної сторінки (замість Stripe). Оберіть результат:</p>
<div class="actions"><form method="post" action="${base}/mock/ok"><button class="b">✓ Оплата успішна</button></form><form method="post" action="${base}/mock/fail"><button class="b ghost">✕ Оплата не пройшла</button></form></div></section>`);
}
function markPaid(o, info = {}) {
  o.status = 'queued'; o.paidAt = new Date().toISOString(); if (info.amount) o.amount = info.amount; o.payMethod = info.method || o.payMethod || '';
  log(o, `оплачено ${o.amount || ''} ${o.payMethod}`.trim()); notify(o, `💰 Оплачено ${o.amount || ''} ${o.payMethod}`); save(o); setImmediate(tick);
}
function retryOrder(o) {   // нова заявка з новим номером, те саме ім'я/фото/email; стара лишається як «оплата не пройшла»
  const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(odir(id), { recursive: true });
  if (o.photo && fs.existsSync(path.join(odir(o.id), o.photo))) fs.copyFileSync(path.join(odir(o.id), o.photo), path.join(odir(id), o.photo));
  const n = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: o.childName, nameInput: o.nameInput, email: o.email, lang: o.lang,
    photo: o.photo, test: o.test || undefined, status: 'awaiting_payment', nameCheck: o.nameCheck || [], retryOf: o.no, createdAt: new Date().toISOString() };
  log(n, `створено повторно після невдалої оплати ${o.no}`); save(n);
  o.retriedAs = n.no; log(o, `повторна заявка ${n.no}`); save(o);
  return n;
}
const LT = {
  'sr-Latn': { title: 'Moja porudžbina', h: 'Preuzmite svoju čestitku', p: 'Za to su vam potrebni email sa kog ste poručili i broj porudžbine.', email: 'Email', no: 'Broj porudžbine', go: 'Uđi',
    err: 'Email i broj porudžbine se ne poklapaju. Proverite i pokušajte ponovo.', many: 'Previše pokušaja. Pokušajte ponovo za 10 minuta.', help: 'Ne sećate se broja porudžbine? Nalazi se u emailu i na stranici posle porudžbine. Ako ga nemate, pišite nam.', home: '← Nazad na početnu' },
  'sr-Cyrl': { title: 'Моја поруџбина', h: 'Преузмите своју честитку', p: 'За то су вам потребни email са ког сте поручили и број поруџбине.', email: 'Email', no: 'Број поруџбине', go: 'Уђи',
    err: 'Email и број поруџбине се не поклапају. Проверите и покушајте поново.', many: 'Превише покушаја. Покушајте поново за 10 минута.', help: 'Не сећате се броја поруџбине? Налази се у email-у и на страници после поруџбине. Ако га немате, пишите нам.', home: '← Назад на почетну' },
  uk: { title: 'Моє замовлення', h: 'Отримайте ваше привітання', p: 'Для цього потрібні email, з якого ви замовляли, і номер замовлення.', email: 'Email', no: 'Номер замовлення', go: 'Увійти',
    err: 'Email і номер замовлення не збігаються. Перевірте й спробуйте ще раз.', many: 'Забагато спроб. Спробуйте ще раз за 10 хвилин.', help: 'Не пам’ятаєте номер замовлення? Він є в листі та на сторінці після замовлення. Якщо його немає, напишіть нам.', home: '← Повернутися на головну' },
};
function pickLang(req, q) {
  if (LT[q]) return q;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return /^(uk|ru)/.test(al) ? 'uk' : 'sr-Latn';
}
function loginPage(lang, err = '', email = '', no = '') {
  const t = LT[lang], langs = [['sr-Latn', 'SR'], ['sr-Cyrl', 'СР'], ['uk', 'UA']].map(([k, l]) => k === lang ? `<b>${l}</b>` : `<a href="/porudzbina?lang=${k}">${l}</a>`).join(' · ');
  return page(t.title + ' · Čestitam', `<style>
.lg{display:grid;grid-template-columns:1fr 1fr;overflow:hidden;padding:0}.lg-art{background:url(/img/kuca.webp) center/cover;min-height:420px;position:relative}.lg-art:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,#0f231bcc)}
.lg-f{padding:28px 26px;display:flex;flex-direction:column;gap:14px}.lg-f h1{font-size:clamp(26px,4vw,34px);margin:0}.lg-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--mut)}
.lg-f input{font:16px system-ui,sans-serif;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:#0e211a;color:var(--ink)}.lg-f input:focus{outline:2px solid var(--gold);outline-offset:1px}
.lg-f .b{justify-content:center;width:100%;padding:14px;font-size:16px}.err{background:#c8453b22;border:1px solid var(--red);border-radius:12px;padding:10px 12px;margin:0;font-size:14px}.lang{font-size:14px;color:var(--mut)}
@media(max-width:700px){.lg{grid-template-columns:1fr}.lg-art{min-height:180px}}</style>
<header class="top"><a class="logo" href="/" style="text-decoration:none">✳ Čestitam</a><span class="lang">${langs}</span></header>
<section class="card lg"><div class="lg-art" role="img" aria-label=""></div>
<form class="lg-f" method="post" action="/porudzbina" style="display:flex"><input type="hidden" name="lang" value="${esc(lang)}">
<h1>${esc(t.h)}</h1><p class="muted" style="margin:0">${esc(t.p)}</p>
${err ? `<p class="err" role="alert">${esc(t[err])}</p>` : ''}
<label>${esc(t.email)}<input type="email" name="email" required autocomplete="email" inputmode="email" value="${esc(email)}"></label>
<label>${esc(t.no)}<input name="no" required autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="CT-00001" value="${esc(no)}"></label>
<button class="b" type="submit">${esc(t.go)}</button>
<p class="muted" style="margin:0">${esc(t.help)}</p><a class="muted" href="/">${esc(t.home)}</a></form></section>`, lang);
}
const CSV_COLS = [['no', 'Номер'], ['createdAt', 'Створено'], ['childName', "Ім'я дитини"], ['email', 'Email'], ['lang', 'Мова'], ['status', 'Статус'],
  ['amount', 'Сума'], ['payMethod', 'Оплата'], ['paidAt', 'Оплачено'], ['sentAt', 'Надіслано'], ['note', 'Нотатка']];
function ordersCsv(bom = true) {   // лише дані замовлення, без фото і відео
  const q = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return (bom ? '\ufeff' : '') + [CSV_COLS.map(c => c[1]).join(','), ...listOrders().filter(o => !o.test).map(o => CSV_COLS.map(([k]) => q(k === 'status' ? (STU[o.status] || o.status) : o[k])).join(','))].join('\n');
}
const STU = { awaiting_payment: 'Чекає оплату', queued: 'У черзі', rendering: 'Рендер', review: 'На перевірці', sent: 'Надіслано', failed: 'Помилка', rejected: 'Скасовано', payment_failed: 'Оплата не пройшла' };
function adminPage(q = '', st = '') {
  const everything = listOrders(), all = everything.filter(o => !o.test), day = new Date().toISOString().slice(0, 10), wk = Date.now() - 7 * 864e5;
  const cnt = (f) => all.filter(f).length, money = all.reduce((a, o) => a + (Number(o.amount) || 0), 0);
  const rs = all.map(o => o.result?.renderSeconds).filter(Boolean), avg = rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length / 60) : null;
  let disk = ''; try { const f = fs.statfsSync(DATA); disk = Math.round(f.bavail * f.bsize / 1e9) + ' ГБ'; } catch {}
  const tiles = [['Сьогодні', cnt(o => o.createdAt.startsWith(day))], ['За 7 днів', cnt(o => Date.parse(o.createdAt) > wk)], ['Чекають оплату', cnt(o => o.status === 'awaiting_payment')],
    ['Черга / рендер', cnt(o => ['queued', 'rendering'].includes(o.status))], ['На перевірці', cnt(o => o.status === 'review')], ['Надіслано', cnt(o => o.status === 'sent')],
    ['Виручка', money ? money.toLocaleString('uk-UA') : '0'], ['Сер. рендер', avg != null ? avg + ' хв' : '—'], ['Вільно на диску', disk || '—']]
    .map(([l, v]) => `<div class="kpi"><span class="muted">${l}</span><b>${esc(String(v))}</b></div>`).join('');
  const ql = q.trim().toLowerCase();
  const list = everything.filter(o => (!st || o.status === st) && (!ql || [o.no, o.id, o.childName, o.nameInput, o.email].some(v => String(v || '').toLowerCase().includes(ql))));
  const opts = ['', ...Object.keys(STU)].map(k => `<option value="${k}"${k === st ? ' selected' : ''}>${k ? STU[k] : 'Усі статуси'}</option>`).join('');
  const rows = list.slice(0, 200).map(o => `<div class="card"><b>${esc(o.childName)}</b> <span class="tag">${esc(STU[o.status] || o.status)}</span> <span class="tag">№ ${esc(o.no || '')}</span>${o.test ? ' <span class="tag" style="color:var(--gold)">ТЕСТ</span>' : ''}${o.retryOf ? ` <span class="muted">повтор після ${esc(o.retryOf)}</span>` : ''}${o.retriedAs ? ` <span class="muted">→ ${esc(o.retriedAs)}</span>` : ''} <span class="muted">${esc(o.email)} · ${esc(o.createdAt.slice(0, 16).replace('T', ' '))} · ${esc(o.lang)}</span>
${o.nameInput && o.nameInput !== o.childName ? `<p class="muted">Введено: ${esc(o.nameInput)}</p>` : ''}${o.nameCheck?.length ? `<p class="muted">Ім'я перевірити: ${esc(o.nameCheck.join(', '))}</p>` : ''}
${o.amount ? `<p class="muted">Оплата: ${esc(String(o.amount))} ${esc(o.payMethod || '')} · ${esc((o.paidAt || '').slice(0, 16).replace('T', ' '))}</p>` : ''}
${o.result?.reviewReasons?.length ? `<p class="muted">Зауваження: ${esc(o.result.reviewReasons.join(', '))}</p>` : ''}${o.error ? `<p class="muted">Помилка: ${esc(o.error.slice(0, 400))}</p>` : ''}
${o.video && fs.existsSync(path.join(odir(o.id), o.video)) ? `<video controls preload="none" src="/admin/v/${o.id}.mp4"></video>` : ''}
<p>${o.status === 'awaiting_payment' ? `<form method="post" action="/admin/${o.id}/paid" class="pay"><input name="amount" inputmode="decimal" placeholder="Сума" size="7"><select name="method"><option>картка</option><option>переказ</option><option>готівка</option><option>інше</option></select><button class="b">Оплачено → у чергу</button></form> ` : ''}${['review', 'sent'].includes(o.status) ? btn(o, 'approve', o.status === 'sent' ? 'Надіслати ще раз' : 'Підтвердити і надіслати') : ''}
${['review', 'failed', 'sent'].includes(o.status) ? btn(o, 'rerender', 'Перерендерити') : ''}${o.status !== 'rejected' ? btn(o, 'reject', 'Скасувати') : ''}
<a class="muted" href="/o/${o.id}/${o.key}">сторінка клієнта</a></p>
<form method="post" action="/admin/${o.id}/note" class="note"><input name="note" maxlength="500" placeholder="Нотатка до замовлення" value="${esc(o.note || '')}"><button class="b ghost">Зберегти</button></form>
<details><summary class="muted">Історія (${(o.log || []).length})</summary><pre class="muted" style="white-space:pre-wrap">${esc((o.log || []).join('\n'))}</pre></details></div>`).join('');
  return page('Адмінка', `<style>.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 0 18px}.kpi{background:#173328;border:1px solid var(--line);border-radius:14px;padding:12px}.kpi b{display:block;font-size:24px;color:var(--gold)}
.flt{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}input,select{font:15px system-ui,sans-serif;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:#0e211a;color:var(--ink)}.flt input{flex:1;min-width:200px}
.note{display:flex;gap:8px;margin:8px 0}.note input{flex:1}.pay{display:inline-flex;gap:6px;flex-wrap:wrap}</style>
<header class="top"><span class="logo">✳ Čestitam · CRM</span><span><form method="post" action="/admin/test-order" style="display:inline"><button class="b ghost">+ Тестове замовлення</button></form> <a class="muted" href="/admin/export.csv">⬇ CSV</a></span></header>
<div class="kpis">${tiles}</div>
<form class="flt" method="get" action="/admin" style="display:flex"><input name="q" value="${esc(q)}" placeholder="Пошук: номер, ім'я, email"><select name="st">${opts}</select><button class="b">Знайти</button></form>
<p class="muted">Знайдено: ${list.length}. Оплата: ${PAYMENT_MODE}, автонадсилання: ${AUTO_SEND ? 'так' : 'ні (після перевірки)'}</p>${rows || '<p>Нічого не знайдено.</p>'}`);
}
const btn = (o, act, label) => `<form method="post" action="/admin/${o.id}/${act}"><button class="b">${label}</button></form> `;

function streamFile(req, res, file, download) {
  let st; try { st = fs.statSync(file); } catch { return send(res, 404, { error: 'not_found' }); }
  const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  if (download) h['Content-Disposition'] = 'attachment; filename="cestitka.mp4"';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
    return fs.createReadStream(file, { start: s, end: e }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': st.size }); fs.createReadStream(file).pipe(res);
}

// ---------- маршрути ----------
const server = http.createServer(async (req, res) => {
  try {
    cors(req, res);
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const u = new URL(req.url, PUBLIC_URL), p = u.pathname;

    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, busy, queued: listOrders().filter(o => o.status === 'queued' && !o.test).length });

    if (req.method === 'POST' && p === '/api/orders') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (rateLimited(ip)) return send(res, 429, { error: 'too_many' });
      const body = JSON.parse((await readBody(req, MAX_PHOTO * 1.4 + 20000)).toString('utf8'));
      const name = String(body.name || '').trim().slice(0, 40), email = String(body.email || '').trim().slice(0, 120);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'email' });
      const nm = resolveName(name); if (!name || !nm.ok) return send(res, 400, { error: 'name' });
      const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(body.photo || ''));
      if (!m) return send(res, 400, { error: 'photo' });
      const buf = Buffer.from(m[1], 'base64'), ext = photoExt(buf);
      if (!ext || buf.length > MAX_PHOTO || buf.length < 10000) return send(res, 400, { error: 'photo' });
      const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex');
      fs.mkdirSync(odir(id), { recursive: true });
      fs.writeFileSync(path.join(odir(id), `photo.${ext}`), buf);
      const o = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: nm.nominative, nameInput: name, email,
        lang: ['uk', 'sr-Latn', 'sr-Cyrl'].includes(body.lang) ? body.lang : 'sr-Latn', photo: `photo.${ext}`,
        status: PAYMENT_MODE === 'none' ? 'queued' : 'awaiting_payment', nameCheck: nm.needsReview ? nm.reviewReasons : [], createdAt: new Date().toISOString() };
      log(o, 'створено'); save(o); notify(o, '🆕 Нове замовлення'); setImmediate(tick);
      return send(res, 201, { id, no: o.no, status: o.status, url: `${PUBLIC_URL}/o/${id}/${o.key}` });
    }

    // Google Таблиця: =IMPORTDATA("https://…/api/export.csv?token=EXPORT_TOKEN"), лише дані замовлень, без фото
    if (req.method === 'GET' && p === '/api/export.csv') {
      const t = u.searchParams.get('token') || '';
      if (!ENV.EXPORT_TOKEN || ENV.EXPORT_TOKEN.length < 24 || !safeEq(h(t), h(ENV.EXPORT_TOKEN))) return send(res, 403, { error: 'forbidden' });
      return send(res, 200, ordersCsv(false), { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    // вхід клієнта: email + номер замовлення -> його сторінка
    if (p === '/porudzbina' && req.method === 'GET') return send(res, 200, loginPage(pickLang(req, u.searchParams.get('lang'))), { 'Cache-Control': 'no-store' });
    if (p === '/porudzbina' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const f = new URLSearchParams((await readBody(req, 4000)).toString('utf8'));
      const lang = LT[f.get('lang')] ? f.get('lang') : 'sr-Latn';
      const email = String(f.get('email') || '').trim().toLowerCase().slice(0, 120), no = String(f.get('no') || '').replace(/\D/g, '').slice(0, 8);
      if (loginLimited('ip:' + ip) || (email && loginLimited('em:' + email))) { event({ msg: 'вхід клієнта: забагато спроб', ip, email }); return send(res, 429, loginPage(lang, 'many', email, no)); }
      const n = Number(no), em = (x) => safeEq(h(String(x.email || '').toLowerCase()), h(email));
      const o = no && (listOrders().find(x => x.seq === n && em(x)) || (no.length === 6 && listOrders().find(x => x.noOld === no && em(x))));
      if (!o) { event({ msg: 'вхід клієнта: не збіглося', ip, email, no }); return send(res, 200, loginPage(lang, 'err', email, no), { 'Cache-Control': 'no-store' }); }
      log(o, `клієнт увійшов (${ip})`); save(o);
      return send(res, 303, '', { Location: `/o/${o.id}/${o.key}` });
    }

    let mm;
    // оплата: /o/<id>/<key>/pay | retry | mock/ok | mock/fail
    if (req.method === 'POST' && (mm = /^\/o\/([\w-]+)\/([a-f0-9]{32})\/(pay|retry|mock\/ok|mock\/fail)$/.exec(p))) {
      const o = load(mm[1]); if (!o || !safeEq(o.key, mm[2])) return send(res, 404, {});
      const base = `/o/${o.id}/${o.key}`, act = mm[3];
      if (act === 'pay') {
        if (o.status !== 'awaiting_payment') return send(res, 303, '', { Location: base });
        if (!canPay(o)) return send(res, 303, '', { Location: base });
        log(o, 'клієнт перейшов до оплати'); save(o);
        return send(res, 200, mockCheckout(o));   // тут буде перехід на Stripe Checkout
      }
      if (act === 'mock/ok' && canPay(o) && o.status === 'awaiting_payment') { markPaid(o, { method: o.test ? 'тест' : 'mock' }); return send(res, 303, '', { Location: base + '?pay=paid' }); }
      if (act === 'mock/fail' && canPay(o) && o.status === 'awaiting_payment') { o.status = 'payment_failed'; log(o, 'оплата не пройшла'); save(o); return send(res, 303, '', { Location: base }); }
      if (act === 'retry' && o.status === 'payment_failed') {
        if (o.retriedAs) { const prev = listOrders().find(x => x.no === o.retriedAs); if (prev) return send(res, 303, '', { Location: `/o/${prev.id}/${prev.key}` }); }
        const n = retryOrder(o); return send(res, 303, '', { Location: `/o/${n.id}/${n.key}` });
      }
      return send(res, 303, '', { Location: base });
    }
    if ((mm = /^\/o\/([\w-]+)\/([a-f0-9]{32})(\/video\.mp4)?$/.exec(p))) {
      const o = load(mm[1]); if (!o || !safeEq(o.key, mm[2])) return send(res, 404, page('Nije pronađeno', '<h1>Nije pronađeno</h1>'));
      if (!mm[3]) return send(res, 200, customerPage(o, u.searchParams.get('pay') || ''), { 'Cache-Control': 'no-store' });
      if (o.status !== 'sent') return send(res, 404, { error: 'not_ready' });
      if (o.videoPurged) return send(res, 410, { error: 'expired' });
      return streamFile(req, res, path.join(odir(o.id), o.video), u.searchParams.has('dl'));   // завжди оригінал, без перестиснення
    }

    // адмінка
    if (p === '/admin/login' && req.method === 'GET') {
      const t = u.searchParams.get('token') || '';
      if (!ADMIN_TOKEN || !safeEq(crypto.createHash('sha256').update(t).digest('hex'), crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex'))) return send(res, 403, page('Ні', '<h1>Доступ заборонено</h1>'));
      event({ msg: 'адмін увійшов', ip: (req.headers['x-forwarded-for'] || '').split(',')[0] });
      return send(res, 302, '', { 'Set-Cookie': `adm=${crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex')}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=2592000`, Location: '/admin' });
    }
    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) return send(res, 403, page('Ні', '<h1>Увійдіть через /admin/login?token=…</h1>'));
      if (p === '/admin' && req.method === 'GET') return send(res, 200, adminPage(u.searchParams.get('q') || '', u.searchParams.get('st') || ''), { 'Cache-Control': 'no-store' });
      if (p === '/admin/test-order' && req.method === 'POST') {   // перевірка кругу оплати без рендеру і без витрат
        const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex');
        fs.mkdirSync(odir(id), { recursive: true });
        const o = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: 'Milica', nameInput: 'Milica', email: 'test@cestitam.eu', lang: 'uk',
          photo: null, test: true, status: 'awaiting_payment', nameCheck: [], createdAt: new Date().toISOString() };
        log(o, 'створено тестове замовлення з адмінки'); save(o);
        return send(res, 303, '', { Location: `/o/${o.id}/${o.key}` });
      }
      if (p === '/admin/export.csv') { event({ msg: 'адмін: експорт CSV' }); return send(res, 200, ordersCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zamovlennya.csv"', 'Cache-Control': 'no-store' }); }
      if ((mm = /^\/admin\/([\w-]+)\/note$/.exec(p)) && req.method === 'POST') {
        const o = load(mm[1]); if (!o) return send(res, 404, {});
        const f = new URLSearchParams((await readBody(req, 4000)).toString('utf8'));
        o.note = String(f.get('note') || '').slice(0, 500); log(o, 'нотатка: ' + o.note); save(o);
        return send(res, 303, '', { Location: '/admin?q=' + (o.no || o.id) });
      }
      if ((mm = /^\/admin\/v\/([\w-]+)\.mp4$/.exec(p))) { const o = load(mm[1]); return o ? streamFile(req, res, path.join(odir(o.id), o.video || 'x')) : send(res, 404, {}); }
      if ((mm = /^\/admin\/([\w-]+)\/(paid|approve|rerender|reject)$/.exec(p)) && req.method === 'POST') {
        const o = load(mm[1]); if (!o) return send(res, 404, {});
        const act = mm[2];
        if (act === 'paid') { const f = new URLSearchParams((await readBody(req, 2000)).toString('utf8'));
          const amt = Number(String(f.get('amount') || '').replace(',', '.')); if (amt > 0) o.amount = amt; o.payMethod = String(f.get('method') || '').slice(0, 20);
          o.status = 'queued'; o.paidAt = new Date().toISOString(); notify(o, `💰 Оплачено ${o.amount || ''} ${o.payMethod}`); }
        if (act === 'approve') { o.status = 'sent'; o.sentAt = new Date().toISOString(); await emailCustomer(o); }
        if (act === 'rerender') { o.status = 'queued'; o.attempts = 0; delete o.error; }
        if (act === 'reject') o.status = 'rejected';
        log(o, 'адмін: ' + act + (act === 'paid' && o.amount ? ` ${o.amount} ${o.payMethod}` : '')); save(o); setImmediate(tick);
        return send(res, 303, '', { Location: '/admin' });
      }
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    send(res, e.code === 413 ? 413 : 500, { error: e.code === 413 ? 'too_large' : 'server' });
    if (e.code !== 413) console.error(e);
  }
});
server.requestTimeout = 120e3;
server.listen(PORT, () => console.log(`orders server on :${PORT}, data ${DATA}, master ${MASTER}`));
