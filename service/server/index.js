'use strict';
// Сервер замовлень: прийом (ім'я + фото + email) -> черга -> рендер -> перевірка -> лист клієнту з посиланням.
// Без зовнішніх залежностей: лише Node 18+, ffmpeg, ImageMagick, Python (див. Dockerfile).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveName } = require('../src/names');
const agents = require('./agents');
const { agentsPage } = require('./agents-page');
const report = require('./report');
const support = require('./support');
const { widgetJs, widgetCss } = require('./support-widget');
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
// у .env можна тримати не сам токен, а лише його хеш: ADMIN_TOKEN_SHA256 (64 hex). Тоді навіть із копії .env токен не дізнатися.
const ADMIN_HASH = /^[a-f0-9]{64}$/i.test(ENV.ADMIN_TOKEN_SHA256 || '') ? ENV.ADMIN_TOKEN_SHA256.toLowerCase()
  : ADMIN_TOKEN.length >= 24 ? crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex') : '';
// адреса входу в адмінку прихована: ADMIN_LOGIN_PATH=/admin/<щось-своє>. Без входу всі /admin… відповідають «не знайдено».
const LOGIN_PATH = /^\/admin\/[\w-]{4,64}$/.test(ENV.ADMIN_LOGIN_PATH || '') ? ENV.ADMIN_LOGIN_PATH : '/admin/login';
const ORIGINS = (ENV.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const PAYMENT_MODE = ENV.PAYMENT_MODE || 'manual';      // manual: адмін позначає «оплачено»; none: одразу в чергу
const AUTO_SEND = ENV.AUTO_SEND === '1';                 // 1: ролик без зауважень іде клієнту без ручної перевірки
const MAX_PHOTO = 12 << 20;
const KEEP_PHOTO_DAYS = Number(ENV.KEEP_PHOTO_DAYS || 30);   // фото дитини видаляємо через N днів після відправки
const KEEP_VIDEO_DAYS = Number(ENV.KEEP_VIDEO_DAYS || 60);   // відео — через N днів
const AVG_RENDER_MIN = 8;
fs.mkdirSync(ORDERS, { recursive: true });
if (!ADMIN_HASH) console.warn('[warn] ADMIN_TOKEN (від 24 символів) або ADMIN_TOKEN_SHA256 не задано: адмінка вимкнена');

// ---------- сховище ----------
const odir = (id) => path.join(ORDERS, id);
const load = (id) => { try { return JSON.parse(fs.readFileSync(path.join(odir(id), 'order.json'), 'utf8')); } catch { return null; } };
function save(o) {
  o.updatedAt = new Date().toISOString();
  const f = path.join(odir(o.id), 'order.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f);
  report.sheetSync(o, (r) => event(r));   // Google-таблиця: лише оплачені замовлення
}
const listOrders = () => fs.readdirSync(ORDERS).map(load).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
// короткий номер замовлення для клієнта (6 цифр, унікальний): вхід на /porudzbina = email + номер
// номер замовлення по порядку: CT-00001, CT-00002 … (seq — число, no — те, що бачить клієнт)
// дві літери спереду щоразу випадкові (без схожих на цифри I, O, Q), напр. KM-00006
const LET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const letters = () => LET[crypto.randomInt(LET.length)] + LET[crypto.randomInt(LET.length)];
const fmtNo = (n, l = letters()) => `${l}-${String(n).padStart(5, '0')}`;
let lastSeq = 0;
function newNo() { lastSeq += 1; return { seq: lastSeq, no: fmtNo(lastSeq) }; }
// журнал: історія в самому замовленні + загальний файл подій за день (logs/РРРР-ММ-ДД.jsonl), нічого не видаляється
const LOGS = path.join(DATA, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
function event(rec) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(path.join(LOGS, ts.slice(0, 10) + '.jsonl'), JSON.stringify({ ts, ...rec }) + '\n'); } catch (e) { console.error('log', e.message); }
}
const log = (o, msg, extra = {}) => { const ts = new Date().toISOString(); (o.log ||= []).push(`${ts} ${msg}`);
  event({ order: o.id, no: o.no, name: o.childName, email: o.email, status: o.status, test: o.test || undefined, msg, ...extra }); };
// що агенти роблять просто зараз (для сторінки /admin/agents)
const NOW = { orders: null, video: null };

// ---------- HTTP-допоміжні ----------
function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body), isStr = typeof body === 'string';
  const sec = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()' };
  if (isStr && body.startsWith('<!doctype')) {   // HTML: скрипти лише з разовим nonce, без чужих доменів, без вбудовування в iframe
    const n = crypto.randomBytes(16).toString('base64');
    body = body.replace(/<script nonce="r">/g, `<script nonce="${n}">`).replace(/<script>/g, `<script nonce="${n}">`);
    sec['Content-Security-Policy'] = `default-src 'self'; script-src 'self' 'nonce-${n}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`;
  }
  res.writeHead(code, { 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json', ...sec, ...headers });
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
  if (!ADMIN_HASH) return false;
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('adm='));
  const s = c && /^[a-f0-9]{64}$/.test(c.slice(4)) && SESS[h(c.slice(4))];
  return !!s && s.exp > Date.now();
}
// простий ліміт: 5 замовлень на IP за 10 хв
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 600e3);
  arr.push(now); hits.set(ip, arr); return arr.length > 5;
}
const loginHits = new Map();
const failDay = new Map(); setInterval(() => failDay.clear(), 864e5).unref();   // невдалі входи за добу на телефон/email
function loginLimited(k) {   // не більше 5 спроб за 10 хв на IP і окремо на email
  const now = Date.now(), arr = (loginHits.get(k) || []).filter(t => now - t < 600e3);
  arr.push(now); loginHits.set(k, arr); return arr.length > 5;
}
// телефон: лише цифри у міжнародному вигляді (381641234567). 06x… → Сербія (+381), 00… → міжнародний
function normPhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '381' + d.slice(1);
  d = d.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(d) ? d : '';
}
const showPhone = (d) => d ? '+' + d : '';
// чистимо старі записи лімітів, щоб памʼять не росла
setInterval(() => { const now = Date.now();
  for (const m of [hits, loginHits, adminHits]) for (const [k, arr] of m) if (!arr.some(t => now - t < 864e5)) m.delete(k); }, 600e3).unref();
const adminHits = new Map();
function adminLimited(ip) { const now = Date.now(), arr = (adminHits.get(ip) || []).filter(t => now - t < 3600e3); arr.push(now); adminHits.set(ip, arr); return arr.length > 10; }
// сесії адмінки: випадковий ідентифікатор у cookie, на сервері зберігаємо лише його хеш (файл sessions.json)
const SESS_FILE = path.join(DATA, 'admin_sessions.json'), SESS_DAYS = 30;
let SESS = {}; try { SESS = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')); } catch {}
const saveSess = () => { try { fs.writeFileSync(SESS_FILE + '.tmp', JSON.stringify(SESS), { mode: 0o600 }); fs.renameSync(SESS_FILE + '.tmp', SESS_FILE); } catch (e) { console.error('sessions', e.message); } };
function newSession(ip) {
  const now = Date.now(); for (const [k, v] of Object.entries(SESS)) if (v.exp < now) delete SESS[k];
  const sid = crypto.randomBytes(32).toString('hex'); SESS[h(sid)] = { ip, at: new Date().toISOString(), exp: now + SESS_DAYS * 864e5 }; saveSess(); return sid;
}
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function photoExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(4, 12).toString().match(/ftyp(heic|heix|mif1|msf1|hevc)/)) return 'heic';
  return null;
}

// ---------- лист клієнту (Resend, якщо є ключ) ----------
const T = {
  'sr-Latn': { subj: 'Vaša čestitka od Deda Mraza je spremna ✦', body: (n, u, no) => `Zdravo!\n\nČestitka za ${n} je spremna. Pogledajte i preuzmite je ovde:\n${u}\n\nBroj porudžbine: ${no}\nStranici možete pristupiti i preko cestitam.eu/porudzbina (telefon ili email + broj porudžbine).\n\nSrećni praznici!\nČestitam · cestitam.eu` },
  'sr-Cyrl': { subj: 'Ваша честитка од Деда Мраза је спремна ✦', body: (n, u, no) => `Здраво!\n\nЧеститка за ${n} је спремна. Погледајте и преузмите је овде:\n${u}\n\nБрој поруџбине: ${no}\nСтраници можете приступити и преко cestitam.eu/porudzbina (телефон или email + број поруџбине).\n\nСрећни празници!\nЧеститам · cestitam.eu` },
  uk: { subj: 'Ваше відеопривітання готове ✦', body: (n, u, no) => `Вітаємо!\n\nПривітання для ${n} готове. Переглянути і завантажити:\n${u}\n\nНомер замовлення: ${no}\nСторінку можна відкрити й через cestitam.eu/porudzbina (телефон або email + номер замовлення).\n\nЗі святами!\nČestitam · cestitam.eu` },
};
async function emailCustomer(o) {
  const url = `${PUBLIC_URL}/o/${o.id}/${o.key}`;
  if (!o.email) { log(o, 'email не вказано, відео лише на сайті'); return false; }
  if (!ENV.RESEND_API_KEY || !ENV.MAIL_FROM) { log(o, `email: ключа нема, посилання для ручної відправки ${url}`); return false; }
  const t = T[o.lang] || T['sr-Latn'];
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: ENV.MAIL_FROM, to: [o.email], subject: t.subj, text: t.body(o.childName, url, o.no) }) });
  log(o, `email ${r.ok ? 'надіслано' : 'помилка ' + r.status}`); return r.ok;
}

// ---------- Telegram: сповіщення власнику (TG_BOT_TOKEN + TG_CHAT_ID у .env) ----------
function notify(o, what) {
  if (o.test) return;
  agents.tg(`${what}\n№ ${o.no || o.id} · ${o.childName}${o.phone ? ' · ' + showPhone(o.phone) : ''}${o.email ? ' · ' + o.email : ''}\n${PUBLIC_URL}/admin?q=${o.no || o.id}`);
}

// ---------- воркер: одне замовлення за раз ----------
let busy = false;
async function tick() {
  if (busy) return;
  const o = listOrders().reverse().find(x => x.status === 'queued' && !x.test);   // тестові замовлення не рендеримо
  if (!o) return;
  busy = true;
  // агент 1: контроль замовлення перед рендером (оплата, фото, ім'я); підозріле — чекає вашого «OK»
  if (!o.check || (o.paidAt && o.check.at < o.paidAt)) {
    NOW.orders = { no: o.no, name: o.childName, since: new Date().toISOString() };
    try { o.check = await agents.checkOrder(o, odir(o.id), { paymentMode: PAYMENT_MODE }); } finally { NOW.orders = null; }
    log(o, o.check.ok ? 'контроль замовлення: усе гаразд' : 'контроль замовлення: ' + o.check.problems.map(agents.label).join(', '),
      { agent: 'orders', ok: o.check.ok, problems: o.check.problems });
  }
  if (!o.check.ok && !o.checkOk) {
    o.status = 'hold'; log(o, 'чекає вашого OK перед рендером', { agent: 'orders', ok: false, hold: true }); save(o);
    notify(o, '⏸ Замовлення чекає вашого OK: ' + o.check.problems.map(agents.label).join(', '));
    busy = false; setImmediate(tick); return;
  }
  o.status = 'rendering'; o.attempts = (o.attempts || 0) + 1; log(o, 'рендер почато'); save(o);
  try {
    const r = await renderInChild({ id: 'video', name: o.childName, photo: path.join(odir(o.id), o.photo), master: MASTER,
      outDir: path.join(odir(o.id), 'out'), allowSpend: true, voiceFile: o.voiceFile });
    o.result = { status: r.status, reviewReasons: r.reviewReasons, renderSeconds: r.renderSeconds, voice: r.voice };
    o.video = 'out/video.mp4';
    // проміжні великі файли не тримаємо
    for (const f of ['portrait_overlay.mkv']) fs.rmSync(path.join(odir(o.id), 'out', f), { force: true });
    log(o, `рендер готовий: ${r.status} ${r.reviewReasons.join(',')}`);
    // агент 2: перевірка готового відео проти мастера
    NOW.video = { no: o.no, name: o.childName, since: new Date().toISOString() };
    try { o.qc = await agents.checkVideo({ masterJson: MASTER, masterVideo: ENV.MASTER_VIDEO || path.join(path.dirname(MASTER), JSON.parse(fs.readFileSync(MASTER, 'utf8')).video),
      video: path.join(odir(o.id), o.video), outDir: path.join(odir(o.id), 'out'), voiceDur: r.voice?.dur }); } finally { NOW.video = null; }
    const bad = agents.qcFails(o.qc);
    log(o, bad.length ? 'перевірка відео: ' + bad.map(c => `${c.label} (${c.detail})`).join('; ') : 'перевірка відео: усе гаразд',
      { agent: 'video', ok: !bad.length, fails: bad.map(c => c.label), frames: Object.keys(o.qc.frames || {}), seconds: o.qc.seconds });
    if (r.status === 'done' && !bad.length && AUTO_SEND) { o.status = 'sent'; o.sentAt = new Date().toISOString(); await emailCustomer(o); }
    else { o.status = 'review'; notify(o, bad.length ? '🎬 Відео готове, але є зауваження: ' + bad.map(c => c.label).join(', ') : '🎬 Відео готове, перевірка пройдена ✓. Подивіться і підтвердіть'); }
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
  } else if (/^CT-/.test(o.no)) { const was = o.no; o.no = fmtNo(o.seq); log(o, `номер ${was} → ${o.no} (літери тепер різні)`); save(o); } }
// після перезапуску: незавершені рендери повертаємо в чергу
for (const o of listOrders()) if (o.status === 'rendering') { o.status = 'queued'; log(o, 'перезапуск сервера'); save(o); }
setInterval(tick, 5000);
agents.startMorning({ listOrders, dataDir: DATA, publicUrl: PUBLIC_URL });
report.startReport({ listOrders, dataDir: DATA, event });
support.init({ dataDir: DATA, tg: agents.tg, publicUrl: PUBLIC_URL, loadOrder: load, event });

// ---------- приватність: автоматичне видалення ----------
const daysSince = (t) => t ? (Date.now() - Date.parse(t)) / 864e5 : 0;
function purge() {
  if (ENV.AUTO_PURGE === '0') return;   // власник погодив автовидалення (27.11): фото 30 днів, відео 60, неоплачені 7
  try { support.purge(); } catch (e) { console.error('support purge', e.message); }   // звернення — через 60 днів
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
  'sr-Latn': { title: 'Čestitka za', st: { awaiting_payment: 'Čeka uplatu', queued: 'U redu za izradu', rendering: 'Deda Mraz upravo snima', review: 'Proveravamo svaki detalj', hold: 'Proveravamo fotografiju i ime', sent: 'Spremno!', failed: 'Došlo je do greške, javićemo vam se', rejected: 'Otkazano', payment_failed: 'Plaćanje nije prošlo' },
    eta: (m) => `Otprilike još ${m} min. Stranica se sama osvežava.`, pay: 'Čim uplata bude potvrđena, počinjemo izradu.', mail: 'Poslaćemo vam i email kada bude spremno.',
    dl: 'Preuzmi video', share: 'Podeli', copy: 'Kopiraj link', copied: 'Link je kopiran', gone: 'Video je obrisan nakon isteka roka čuvanja.', keep: (d) => `Video čuvamo ${d} dana. Preuzmite ga na vreme.`, steps: ['Porudžbina', 'Izrada', 'Provera', 'Spremno'], no: 'Broj porudžbine' },
  uk: { title: 'Привітання для', st: { awaiting_payment: 'Чекаємо оплату', queued: 'У черзі', rendering: 'Дід Мороз записує привітання', review: 'Перевіряємо кожну деталь', hold: 'Перевіряємо фото та ім’я', sent: 'Готово!', failed: 'Сталася помилка, ми зв’яжемося з вами', rejected: 'Скасовано', payment_failed: 'Оплата не пройшла' },
    eta: (m) => `Приблизно ще ${m} хв. Сторінка оновлюється сама.`, pay: 'Щойно оплату підтвердимо, почнемо створення.', mail: 'Коли буде готово, ми також надішлемо лист.',
    dl: 'Завантажити відео', share: 'Поділитися', copy: 'Скопіювати посилання', copied: 'Посилання скопійовано', gone: 'Відео видалено після завершення терміну зберігання.', keep: (d) => `Відео зберігаємо ${d} днів. Завантажте його вчасно.`, steps: ['Замовлення', 'Створення', 'Перевірка', 'Готово'], no: 'Номер замовлення' },
};

const ST = CT['sr-Latn'].st;
function eta(o) {
  if (o.status === 'rendering') return Math.max(2, Math.round(AVG_RENDER_MIN - (Date.now() - Date.parse(o.updatedAt)) / 60e3));
  if (o.status !== 'queued') return null;
  const q = listOrders().filter(x => x.status === 'queued' && !x.test).reverse(); const pos = q.findIndex(x => x.id === o.id);
  return (pos + 1 + (busy ? 1 : 0)) * AVG_RENDER_MIN;
}
Object.assign(CT['sr-Latn'], {
  formed: 'Porudžbina je spremna za plaćanje', formedP: 'Proverite podatke i platite. Izrada počinje odmah posle uplate.',
  child: 'Ime deteta', email: 'Email', phone: 'Telefon', pay: 'Plati', payManual: 'Javićemo vam se sa uputstvom za plaćanje na ovaj email.',
  paidH: 'Plaćeno! Predajemo porudžbinu na izradu', makingH: 'Montiramo video za vas', makingP: 'Video će se pojaviti ovde, na ovoj stranici. Sačuvajte broj porudžbine i broj telefona: sa njima uvek možete otvoriti stranicu na cestitam.eu/porudzbina.',
  failH: 'Plaćanje nije prošlo', failP: 'Novac nije skinut. Pokušajte ponovo: napravićemo novu porudžbinu sa novim brojem, sa istim imenom i fotografijom.', retry: 'Pokušaj ponovo',
  copy1: 'Kopiraj', copied1: 'Kopirano', noMail: 'Niste ostavili email, zato sačuvajte link ove stranice: ovde će se pojaviti vaš video.', copyLink: 'Kopiraj link stranice', test: 'TEST porudžbina: plaćanje je simulirano, video se ne pravi.' });
Object.assign(CT.uk, {
  formed: 'Заявку сформовано, залишилось оплатити', formedP: 'Перевірте дані й оплатіть. Створення починається одразу після оплати.',
  child: 'Ім’я дитини', email: 'Email', phone: 'Телефон', pay: 'Оплатити', payManual: 'Ми надішлемо інструкцію з оплати на цей email.',
  paidH: 'Оплачено! Передаємо замовлення в роботу', makingH: 'Монтуємо відео для вас', makingP: 'Відео з’явиться тут, на цій сторінці. Збережіть номер замовлення та номер телефону: з ними ви завжди відкриєте сторінку на cestitam.eu/porudzbina.',
  failH: 'Оплата не пройшла', failP: 'Гроші не списано. Спробуйте ще раз: ми створимо нову заявку з новим номером, з тим самим ім’ям і фото.', retry: 'Спробувати ще раз',
  copy1: 'Копіювати', copied1: 'Скопійовано', noMail: 'Ви не вказали email, тож збережіть посилання на цю сторінку: тут з’явиться ваше відео.', copyLink: 'Скопіювати посилання', test: 'ТЕСТОВЕ замовлення: оплата імітується, відео не створюється.' });
function cyr(s){const p={'DŽ':'Џ','Dž':'Џ','dž':'џ','LJ':'Љ','Lj':'Љ','lj':'љ','NJ':'Њ','Nj':'Њ','nj':'њ','A':'А','B':'Б','C':'Ц','Č':'Ч','Ć':'Ћ','D':'Д','Đ':'Ђ','E':'Е','F':'Ф','G':'Г','H':'Х','I':'И','J':'Ј','K':'К','L':'Л','M':'М','N':'Н','O':'О','P':'П','R':'Р','S':'С','Š':'Ш','T':'Т','U':'У','V':'В','Z':'З','Ž':'Ж','a':'а','b':'б','c':'ц','č':'ч','ć':'ћ','d':'д','đ':'ђ','e':'е','f':'ф','g':'г','h':'х','i':'и','j':'ј','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п','r':'р','s':'с','š':'ш','t':'т','u':'у','v':'в','z':'з','ž':'ж'};
  return s.replace(/(<[^>]*>)|(\b(?:cestitam\.eu\/porudzbina|Full HD|TV|JPG|PNG|HEIC|MB|email|TEST)\b)|DŽ|Dž|dž|LJ|Lj|lj|NJ|Nj|nj|[A-Za-zČĆĐŠŽčćđšž]/g,(m,tag,keep)=>tag||keep||(p[m]||m));}
// сторінка клієнта кирилицею: перекладаємо латиницю автоматично (як на сайті)
CT['sr-Cyrl'] = Object.fromEntries(Object.entries(CT['sr-Latn']).map(([k, v]) => [k, typeof v === 'string' ? cyr(v) : typeof v === 'function' ? (...a) => cyr(v(...a)) : Array.isArray(v) ? v.map(cyr) : Object.fromEntries(Object.entries(v).map(([x, y]) => [x, cyr(y)]))]));
// імітація оплати лише для тестових замовлень з адмінки; справжній клієнт кнопкою «Оплата успішна» нічого не отримає.
// Небезпечний режим PAYMENT_MODE=mock для всіх працює тільки разом з MOCK_PAY_ALL=1 (і в адмінці горить попередження).
const canPay = (o) => o.test || (PAYMENT_MODE === 'mock' && ENV.MOCK_PAY_ALL === '1');   // Stripe підключимо тут же: PAYMENT_MODE=stripe
function customerPage(o, flash = '') {
  const t = CT[o.lang] || CT['sr-Latn'], ready = o.status === 'sent' && !o.videoPurged;
  const step = { awaiting_payment: 0, payment_failed: 0, hold: 1, queued: 1, rendering: 1, review: 2, sent: 4 }[o.status] ?? 0;
  const m = eta(o), base = `/o/${o.id}/${o.key}`;
  const steps = t.steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"><span>${i < step ? '✓' : i + 1}</span>${esc(s)}</li>`).join('');
  const row = (label, val, copy) => `<div class="kv"><span class="muted">${esc(label)}</span><b>${esc(val)}</b>${copy ? `<button class="b ghost cp" data-v="${esc(val)}">⧉ ${esc(t.copy1)}</button>` : ''}</div>`;
  const facts = (copy) => `<div class="facts">${row(t.no, o.no || o.id, copy)}${o.phone ? row(t.phone, showPhone(o.phone), false) : ''}${o.email ? row(t.email, o.email, copy) : ''}${row(t.child, o.childName)}</div>${o.email ? '' : `<div class="kv"><span class="muted">${esc(t.noMail)}</span><button class="b cp" data-v="${esc(PUBLIC_URL + base)}">⧉ ${esc(t.copyLink)}</button></div>`}`;
  let body;
  if (ready) body = `<video controls playsinline preload="metadata" src="${base}/video.mp4"></video>
<div class="actions"><a class="b" href="${base}/video.mp4?dl=1">⬇ ${esc(t.dl)}</a><button class="b ghost" id="share">↗ ${esc(t.share)}</button><button class="b ghost" id="copy">⧉ ${esc(t.copy)}</button></div>
<p class="muted">${esc(t.keep(KEEP_VIDEO_DAYS))}</p>`;
  else if (o.videoPurged) body = `<p>${esc(t.gone)}</p>`;
  else if (o.status === 'awaiting_payment') body = `<p class="big">${esc(t.formed)}</p><p class="muted">${esc(t.formedP)}</p>${facts(false)}
${canPay(o) ? `<form method="post" action="${base}/pay"><button class="b wide">${esc(t.pay)}</button></form>` : `<p class="muted">${esc(t.payManual)}</p>`}`;
  else if (o.status === 'payment_failed') body = `<div class="wait"><div class="flake bad">!</div><p class="big">${esc(t.failH)}</p><p class="muted">${esc(t.failP)}</p></div>
<form method="post" action="${base}/retry"><button class="b wide red">${esc(t.retry)}</button></form>`;
  else if (['hold', 'queued', 'rendering', 'review'].includes(o.status)) body = `<div class="wait"><div class="flake">❄</div>
${flash === 'paid' ? `<p class="ok">✓ ${esc(t.paidH)}</p>` : ''}<p class="big">${esc(t.makingH)}</p>${m && !o.test ? `<p class="muted">${esc(t.eta(m))}</p>` : ''}</div>
${facts(true)}<p class="muted">${esc(t.makingP)}</p>${o.email ? `<p class="muted">${esc(t.mail)}</p>` : ''}`;
  else body = `<div class="wait"><p class="big">${esc(t.st[o.status] || o.status)}</p></div>${facts(true)}`;
  const live = ['hold', 'queued', 'rendering', 'review'].includes(o.status) && !o.test;
  return page('Čestitam', `<style>.facts{display:grid;gap:8px;margin:16px 0}.kv{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:#0e211a}
.kv span{flex-basis:100%;font-size:13px}.kv b{font-size:19px;letter-spacing:.02em;overflow-wrap:anywhere;flex:1;min-width:0}.kv{row-gap:4px}.kv .b{padding:8px 14px;font-size:14px}.wide{width:100%;justify-content:center;padding:15px;font-size:17px}.red{background:var(--red);color:#fff}
.ok{color:var(--gold);font-weight:600;margin:0}.flake.bad{animation:none;color:var(--red);font:700 44px/1 Georgia,serif}.testb{border:1px dashed var(--gold);border-radius:12px;padding:8px 12px;color:var(--gold);font-size:14px}form{display:block}</style>
<header class="top"><a class="logo" href="/" style="text-decoration:none">✳ Čestitam</a></header>
${o.test ? `<p class="testb">${esc(t.test)}</p>` : ''}
<h1><small>${esc(t.title)}</small>${esc(o.childName)}</h1><ol class="steps">${steps}</ol><section class="card">${body}</section>
${live ? '<script nonce="r">setTimeout(()=>location.replace(location.pathname),30000)</script>' : ''}
<script nonce="r">document.querySelectorAll('.cp').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.v).then(()=>{b.textContent=${JSON.stringify('✓ ' + t.copied1)};setTimeout(()=>b.textContent=${JSON.stringify('⧉ ' + t.copy1)},1800)}));
${ready ? `const u=location.href.split('#')[0];document.getElementById('share').onclick=()=>navigator.share?navigator.share({title:document.title,url:u}).catch(()=>{}):navigator.clipboard.writeText(u);
document.getElementById('copy').onclick=e=>navigator.clipboard.writeText(u).then(()=>{e.target.textContent=${JSON.stringify('✓ ' + t.copied)}});` : ''}</script><script src="/api/support/widget.js" defer></script>`, o.lang);
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
  const n = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: o.childName, nameInput: o.nameInput, email: o.email, phone: o.phone, lang: o.lang,
    photo: o.photo, test: o.test || undefined, status: 'awaiting_payment', nameCheck: o.nameCheck || [], retryOf: o.no, createdAt: new Date().toISOString() };
  log(n, `створено повторно після невдалої оплати ${o.no}`); save(n);
  o.retriedAs = n.no; log(o, `повторна заявка ${n.no}`); save(o);
  return n;
}
const LT = {
  'sr-Latn': { title: 'Moja porudžbina', h: 'Preuzmite svoju čestitku', p: 'Za to su vam potrebni broj telefona (ili email) sa kojim ste poručili i broj porudžbine.', email: 'Telefon ili email', no: 'Broj porudžbine', go: 'Uđi',
    err: 'Telefon/email i broj porudžbine se ne poklapaju. Proverite i pokušajte ponovo. Broj porudžbine upišite ceo, sa slovima (npr. KM-00006).', many: 'Previše pokušaja. Pokušajte ponovo kasnije.', help: 'Ne sećate se broja porudžbine? Nalazi se na stranici posle porudžbine i u emailu. Ako ga nemate, pišite nam.', home: '← Nazad na početnu' },
  'sr-Cyrl': { title: 'Моја поруџбина', h: 'Преузмите своју честитку', p: 'За то су вам потребни број телефона (или email) са којим сте поручили и број поруџбине.', email: 'Телефон или email', no: 'Број поруџбине', go: 'Уђи',
    err: 'Телефон/email и број поруџбине се не поклапају. Проверите и покушајте поново. Број поруџбине упишите цео, са словима латиницом (нпр. KM-00006).', many: 'Превише покушаја. Покушајте поново касније.', help: 'Не сећате се броја поруџбине? Налази се на страници после поруџбине и у email-у. Ако га немате, пишите нам.', home: '← Назад на почетну' },
  uk: { title: 'Моє замовлення', h: 'Отримайте ваше привітання', p: 'Для цього потрібні номер телефону (або email), з яким ви замовляли, і номер замовлення.', email: 'Телефон або email', no: 'Номер замовлення', go: 'Увійти',
    err: 'Телефон/email і номер замовлення не збігаються. Перевірте й спробуйте ще раз. Номер замовлення вводьте повністю, з літерами (напр. KM-00006).', many: 'Забагато спроб. Спробуйте пізніше.', help: 'Не пам’ятаєте номер замовлення? Він є на сторінці після замовлення та в листі. Якщо його немає, напишіть нам.', home: '← Повернутися на головну' },
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
<label>${esc(t.email)}<input name="email" required autocomplete="tel" maxlength="120" placeholder="+381 64 123 4567" value="${esc(email)}"></label>
<label>${esc(t.no)}<input name="no" required autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="KM-00006" value="${esc(no)}"></label>
<button class="b" type="submit">${esc(t.go)}</button>
<p class="muted" style="margin:0">${esc(t.help)}</p><a class="muted" href="/">${esc(t.home)}</a></form></section><script src="/api/support/widget.js" defer></script>`, lang);
}
const CSV_COLS = [['no', 'Номер'], ['createdAt', 'Створено'], ['childName', "Ім'я дитини"], ['email', 'Email'], ['phone', 'Телефон'], ['lang', 'Мова'], ['status', 'Статус'],
  ['amount', 'Сума'], ['payMethod', 'Оплата'], ['paidAt', 'Оплачено'], ['sentAt', 'Надіслано'], ['note', 'Нотатка']];
function ordersCsv(bom = true) {   // лише дані замовлення, без фото і відео
  const q = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return (bom ? '\ufeff' : '') + [CSV_COLS.map(c => c[1]).join(','), ...listOrders().filter(o => !o.test).map(o => CSV_COLS.map(([k]) => q(k === 'status' ? (STU[o.status] || o.status) : k === 'phone' ? showPhone(o.phone) : o[k])).join(','))].join('\n');
}
const STU = { awaiting_payment: 'Чекає оплату', hold: 'Чекає вашого OK', queued: 'У черзі', rendering: 'Рендер', review: 'На перевірці', sent: 'Надіслано', failed: 'Помилка', rejected: 'Скасовано', payment_failed: 'Оплата не пройшла' };
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
  const list = everything.filter(o => (!st || o.status === st) && (!ql || [o.no, o.id, o.childName, o.nameInput, o.email, o.phone, showPhone(o.phone)].some(v => String(v || '').toLowerCase().includes(ql))));
  const opts = ['', ...Object.keys(STU)].map(k => `<option value="${k}"${k === st ? ' selected' : ''}>${k ? STU[k] : 'Усі статуси'}</option>`).join('');
  const rows = list.slice(0, 200).map(o => `<div class="card"><b>${esc(o.childName)}</b> <span class="tag">${esc(STU[o.status] || o.status)}</span> <span class="tag">№ ${esc(o.no || '')}</span>${o.test ? ' <span class="tag" style="color:var(--gold)">ТЕСТ</span>' : ''}${o.retryOf ? ` <span class="muted">повтор після ${esc(o.retryOf)}</span>` : ''}${o.retriedAs ? ` <span class="muted">→ ${esc(o.retriedAs)}</span>` : ''} <span class="muted">${o.phone ? esc(showPhone(o.phone)) + ' · ' : ''}${esc(o.email)} · ${esc(o.createdAt.slice(0, 16).replace('T', ' '))} · ${esc(o.lang)}</span>
${o.nameInput && o.nameInput !== o.childName ? `<p class="muted">Введено: ${esc(o.nameInput)}</p>` : ''}${o.nameCheck?.length ? `<p class="muted">Ім'я перевірити: ${esc(o.nameCheck.map(agents.label).join(', '))}</p>` : ''}
${o.amount ? `<p class="muted">Оплата: ${esc(String(o.amount))} ${esc(o.payMethod || '')} · ${esc((o.paidAt || '').slice(0, 16).replace('T', ' '))}</p>` : ''}
${o.result?.reviewReasons?.length ? `<p class="muted">Зауваження рендеру: ${esc(o.result.reviewReasons.map(agents.label).join(', '))}</p>` : ''}${o.check ? `<p class="${o.check.ok || o.checkOk ? 'muted' : 'warn'}">Контроль замовлення: ${o.check.ok ? '✓ усе гаразд' : esc(o.check.problems.map(agents.label).join(', '))}${o.checkOk && !o.check.ok ? ' (ви дали OK)' : ''}${o.check.notes?.length ? ` · ${esc(o.check.notes.map(agents.label).join(', '))}` : ''}</p>` : ''}
${o.qc ? `<details${agents.qcFails(o.qc).length ? ' open' : ''}><summary class="${agents.qcFails(o.qc).length ? 'warn' : 'muted'}">Перевірка відео: ${agents.qcFails(o.qc).length ? '⚠️ є зауваження (' + agents.qcFails(o.qc).length + ')' : '✓ усе гаразд'}</summary><ul class="qc">${o.qc.checks.map(c => `<li>${c.ok ? '✓' : '✗'} ${esc(c.label)} <span class="muted">${esc(c.detail || '')}</span></li>`).join('')}</ul></details>
<div class="qcf">${Object.keys(o.qc.frames || {}).map(k => `<figure><img loading="lazy" src="/admin/f/${o.id}/${k}.jpg" alt=""><figcaption class="muted">${k === 'book' ? 'Книга' : 'Портрет'}</figcaption></figure>`).join('')}</div>` : ''}${o.error ? `<p class="muted">Помилка: ${esc(o.error.slice(0, 400))}</p>` : ''}
${o.video && fs.existsSync(path.join(odir(o.id), o.video)) ? `<video controls preload="none" src="/admin/v/${o.id}.mp4"></video>` : ''}
<p>${o.status === 'hold' ? btn(o, 'okcheck', 'OK → у рендер') : ''}${o.status === 'awaiting_payment' ? `<form method="post" action="/admin/${o.id}/paid" class="pay"><input name="amount" inputmode="decimal" placeholder="Сума" size="7"><select name="method"><option>картка</option><option>переказ</option><option>готівка</option><option>інше</option></select><button class="b">Оплачено → у чергу</button></form> ` : ''}${['review', 'sent'].includes(o.status) ? btn(o, 'approve', o.status === 'sent' ? 'Надіслати ще раз' : 'Підтвердити і надіслати') : ''}
${['review', 'failed', 'sent'].includes(o.status) ? btn(o, 'rerender', 'Перерендерити') : ''}${o.status !== 'rejected' ? btn(o, 'reject', 'Скасувати') : ''}
<a class="muted" href="/o/${o.id}/${o.key}">сторінка клієнта</a></p>
<form method="post" action="/admin/${o.id}/note" class="note"><input name="note" maxlength="500" placeholder="Нотатка до замовлення" value="${esc(o.note || '')}"><button class="b ghost">Зберегти</button></form>
<details><summary class="muted">Історія (${(o.log || []).length})</summary><pre class="muted" style="white-space:pre-wrap">${esc((o.log || []).join('\n'))}</pre></details></div>`).join('');
  return page('Адмінка', `<style>.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 0 18px}.kpi{background:#173328;border:1px solid var(--line);border-radius:14px;padding:12px}.kpi b{display:block;font-size:24px;color:var(--gold)}
.flt{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}input,select{font:15px system-ui,sans-serif;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:#0e211a;color:var(--ink)}.flt input{flex:1;min-width:200px}
.note{display:flex;gap:8px;margin:8px 0}.note input{flex:1}.pay{display:inline-flex;gap:6px;flex-wrap:wrap}
.warn{color:#ffb4a8;font-size:14px}.probs{border-color:var(--red);background:linear-gradient(180deg,#3a1d1b,#2a1614)}.probs ul{margin:6px 0 0;padding-left:20px}.okbox{color:var(--mut);font-size:14px;margin:0 0 14px}
.qc{margin:6px 0;padding-left:18px;font-size:14px}.qcf{display:flex;gap:10px;flex-wrap:wrap}.qcf figure{margin:0;flex:1;min-width:200px;max-width:420px}.qcf img{width:100%;max-height:300px;object-fit:contain;border-radius:10px;display:block}</style>
<header class="top"><span class="logo">✳ Čestitam · CRM</span><span><a class="b ghost" href="/admin/agents">🤖 Агенти</a> <a class="b ghost" href="/admin/support">💬 Підтримка</a> <form method="post" action="/admin/test-order" style="display:inline"><button class="b ghost">+ Тестове замовлення</button></form> <a class="muted" href="/admin/export.csv">⬇ CSV</a> <form method="post" action="/admin/logout-all" style="display:inline"><button class="b ghost" title="Закрити адмінку на всіх телефонах і компʼютерах">⎋ Вийти всюди</button></form></span></header>
${problemsBox(everything)}<div class="kpis">${tiles}</div>
<form class="flt" method="get" action="/admin" style="display:flex"><input name="q" value="${esc(q)}" placeholder="Пошук: номер, ім'я, телефон, email"><select name="st">${opts}</select><button class="b">Знайти</button></form>
<p class="muted">Знайдено: ${list.length}. Оплата: ${PAYMENT_MODE}, автонадсилання: ${AUTO_SEND ? 'так' : 'ні (після перевірки)'}</p>${rows || '<p>Нічого не знайдено.</p>'}`);
}
function problemsBox(orders) {   // зведення агентів: усе, що потребує вашої уваги
  const pr = [...agents.problemsNow(orders, DATA), ...support.problems()], w = agents.watchdogState(DATA);
  if (PAYMENT_MODE === 'none') pr.unshift({ text: 'PAYMENT_MODE=none: замовлення йдуть у рендер БЕЗ оплати. Для роботи поставте manual.' });
  if (PAYMENT_MODE === 'mock' && ENV.MOCK_PAY_ALL === '1') pr.unshift({ text: 'MOCK_PAY_ALL=1: будь-хто може «оплатити» кнопкою імітації. Вимкніть.' });
  if (!ADMIN_HASH) pr.unshift({ text: 'ADMIN_TOKEN закороткий (менше 24 символів): адмінка не пускає. Задайте довший.' });
  if (ADMIN_TOKEN && ENV.ADMIN_TOKEN_SHA256) pr.unshift({ text: 'У .env є і ADMIN_TOKEN, і ADMIN_TOKEN_SHA256: рядок ADMIN_TOKEN можна прибрати.' });
  if (!pr.length) return `<p class="okbox">✓ Проблем немає. Сторож сервера: ${w ? `перевірка ${w.ageMin} хв тому` : '—'}. Telegram: ${ENV.TG_BOT_TOKEN && ENV.TG_CHAT_ID ? 'увімкнено' : 'не налаштовано'}</p>`;
  return `<section class="card probs"><b>⚠️ Проблеми (${pr.length})</b><ul>${pr.map(x => `<li>${x.link ? `<a href="${esc(x.link)}">${esc(x.text)}</a>` : `${x.o ? `<a href="/admin?q=${esc(x.o.no || x.o.id)}">№ ${esc(x.o.no || '')} ${esc(x.o.childName)}</a>: ` : ''}${esc(x.text)}`}</li>`).join('')}</ul>
<p class="muted">Telegram: ${ENV.TG_BOT_TOKEN && ENV.TG_CHAT_ID ? 'увімкнено' : 'не налаштовано'}</p></section>`;
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
    let mm;

    if (req.method === 'GET' && p === '/health') {   // для сторожа: чи не завис рендер / черга (без особистих даних)
      const all = listOrders().filter(o => !o.test), now = Date.now();
      const q = all.filter(o => o.status === 'queued'), rnd = all.find(o => o.status === 'rendering');
      const renderMin = rnd ? Math.round((now - Date.parse(rnd.updatedAt)) / 60e3) : 0;
      const waitMin = q.length ? Math.round((now - Math.min(...q.map(o => Date.parse(o.paidAt || o.updatedAt)))) / 60e3) : 0;
      return send(res, 200, { ok: true, busy, queued: q.length, renderMin, waitMin, hold: all.filter(o => o.status === 'hold').length });
    }

    if (req.method === 'POST' && p === '/api/orders') {
      const ip = clientIp(req);
      if (rateLimited(ip)) return send(res, 429, { error: 'too_many' });
      try { const fsx = fs.statfsSync(DATA); if (fsx.bavail * fsx.bsize < 3e9) { event({ msg: 'нові замовлення зупинено: мало місця на диску' }); return send(res, 503, { error: 'busy' }); } } catch {}
      const body = JSON.parse((await readBody(req, MAX_PHOTO * 1.4 + 20000)).toString('utf8'));
      const name = String(body.name || '').trim().slice(0, 40), email = String(body.email || '').trim().slice(0, 120);
      if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return send(res, 400, { error: 'email' });   // email за бажанням; лише звичайні символи
      const phone = normPhone(body.phone); if (!phone) return send(res, 400, { error: 'phone' });   // телефон обовʼязковий: з ним клієнт входить на /porudzbina
      const nm = resolveName(name); if (!name || !nm.ok) return send(res, 400, { error: 'name' });
      const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(body.photo || ''));
      if (!m) return send(res, 400, { error: 'photo' });
      const buf = Buffer.from(m[1], 'base64'), ext = photoExt(buf);
      if (!ext || buf.length > MAX_PHOTO || buf.length < 10000) return send(res, 400, { error: 'photo' });
      const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex');
      fs.mkdirSync(odir(id), { recursive: true });
      fs.writeFileSync(path.join(odir(id), `photo.${ext}`), buf);
      const o = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: nm.nominative, nameInput: name, email, phone,
        lang: ['uk', 'sr-Latn', 'sr-Cyrl'].includes(body.lang) ? body.lang : 'sr-Latn', photo: `photo.${ext}`,
        status: PAYMENT_MODE === 'none' ? 'queued' : 'awaiting_payment', nameCheck: nm.needsReview ? nm.reviewReasons : [], createdAt: new Date().toISOString() };
      log(o, 'створено'); save(o); notify(o, '🆕 Нове замовлення'); setImmediate(tick);
      return send(res, 201, { id, no: o.no, status: o.status, url: `${PUBLIC_URL}/o/${id}/${o.key}` });
    }

    // ---------- підтримка: віджет, AI-чат, звернення до оператора ----------
    if (p.startsWith('/api/support/')) {
      const ip = clientIp(req);
      const json = async (n) => { try { return JSON.parse((await readBody(req, n)).toString('utf8')) || {}; } catch (e) { if (e.code === 413) throw e; return {}; } };
      const ord = (x) => { const o = x && load(String(x.id || '')); return o && typeof x.key === 'string' && safeEq(o.key, x.key) ? o : null; };
      if (req.method === 'GET' && p === '/api/support/widget.css') return send(res, 200, widgetCss(), { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (req.method === 'GET' && p === '/api/support/widget.js') return send(res, 200, widgetJs(), { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (req.method === 'POST' && p === '/api/support/chat') {
        const b = await json(20000);
        const r = await support.chat({ history: b.history, lang: b.lang, order: ord(b.order), ip });
        return send(res, r.error ? 400 : 200, r, { 'Cache-Control': 'no-store' });
      }
      if (req.method === 'POST' && p === '/api/support/ticket') {
        const b = await json(8000);
        const r = support.createTicket({ name: b.name, email: b.email, text: b.text, lang: b.lang, order: ord(b.order), ip });
        return send(res, r.error === 'too_many' ? 429 : r.error ? 400 : 201, r, { 'Cache-Control': 'no-store' });
      }
      if ((mm = /^\/api\/support\/ticket\/(T-\d+)\/([a-f0-9]{32})$/.exec(p))) {
        const t = support.getTicket(mm[1], mm[2]); if (!t) return send(res, 404, { error: 'not_found' });
        if (req.method === 'GET') return send(res, 200, support.publicT(t), { 'Cache-Control': 'no-store' });
        if (req.method === 'POST') { const b = await json(8000); const r = support.clientMessage(t, b.text, ip); return send(res, r.error === 'too_many' ? 429 : r.error ? 400 : 200, r); }
      }
      return send(res, 404, { error: 'not_found' });
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
      // вхід: телефон АБО email + ПОВНИЙ номер замовлення з літерами (KM-00006). Без літер номер пускає лише старі 6-значні.
      const ip = clientIp(req);
      const f = new URLSearchParams((await readBody(req, 4000)).toString('utf8'));
      const lang = LT[f.get('lang')] ? f.get('lang') : 'sr-Latn';
      const who = String(f.get('email') || '').trim().slice(0, 120), rawNo = String(f.get('no') || '').trim().slice(0, 16);
      const isMail = who.includes('@'), email = isMail ? who.toLowerCase() : '', phone = isMail ? '' : normPhone(who), idKey = email || phone;
      // ліміти: 5 спроб за 10 хв з одного IP і на один телефон/email, плюс не більше 20 невдалих на день на телефон/email
      if (loginLimited('ip:' + ip) || (idKey && loginLimited('id:' + idKey)) || (idKey && (failDay.get(idKey) || 0) >= 20)) {
        event({ msg: 'вхід клієнта: забагато спроб', ip, who }); return send(res, 429, loginPage(lang, 'many', who, rawNo)); }
      const mt = /^([A-Za-z]{2})\s*-?\s*(\d{1,8})$/.exec(rawNo), digits = rawNo.replace(/\D/g, '');
      const same = (x) => email ? safeEq(h(String(x.email || '').toLowerCase()), h(email)) : (!!phone && safeEq(h(String(x.phone || '')), h(phone)));
      const all = idKey ? listOrders() : [];
      const o = (mt && all.find(x => x.seq === Number(mt[2]) && String(x.no).startsWith(mt[1].toUpperCase() + '-') && same(x)))
        || (!mt && digits.length === 6 && all.find(x => x.noOld === digits && same(x)));
      if (!o) { if (idKey) failDay.set(idKey, (failDay.get(idKey) || 0) + 1);
        event({ msg: 'вхід клієнта: не збіглося', ip, who, no: rawNo }); return send(res, 200, loginPage(lang, 'err', who, rawNo), { 'Cache-Control': 'no-store' }); }
      log(o, `клієнт увійшов (${ip})`); save(o);
      return send(res, 303, '', { Location: `/o/${o.id}/${o.key}` });
    }

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
    // вхід в адмінку: токен вводиться у форму (POST), не в адресу; cookie — випадкова сесія на 30 днів
    const admLogin = (msg = '') => page('Вхід · CRM', `<header class="top"><span class="logo">✳ Čestitam · CRM</span></header><section class="card">
<form method="post" action="${LOGIN_PATH}" style="display:flex;flex-direction:column;gap:12px;max-width:420px"><h1 style="margin:0">Вхід в адмінку</h1>${msg ? `<p class="muted">${esc(msg)}</p>` : ''}
<input type="password" name="token" required autocomplete="current-password" placeholder="ADMIN_TOKEN" style="font:16px system-ui;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0e211a;color:var(--ink)"><button class="b">Увійти</button></form></section>`, 'uk');
    if (p === LOGIN_PATH && req.method === 'GET') return send(res, 200, admLogin(u.searchParams.has('token') ? 'Посилання з токеном у адресі більше не працює (так безпечніше). Вставте токен сюди.' : ''), { 'Cache-Control': 'no-store' });
    if (p === LOGIN_PATH && req.method === 'POST') {
      const ip = clientIp(req);
      if (adminLimited(ip)) { event({ msg: 'адмінка: забагато спроб входу', ip }); return send(res, 429, admLogin('Забагато спроб. Спробуйте за годину.')); }
      const t = new URLSearchParams((await readBody(req, 2000)).toString('utf8')).get('token') || '';
      if (!ADMIN_HASH || !safeEq(h(t), ADMIN_HASH)) {
        event({ msg: 'адмінка: невірний токен', ip }); agents.tg(`⚠️ Невдала спроба входу в адмінку з IP ${ip}`);
        return send(res, 403, admLogin(!ADMIN_HASH ? 'ADMIN_TOKEN закороткий: потрібно щонайменше 24 символи.' : 'Невірний токен.'));
      }
      event({ msg: 'адмін увійшов', ip }); agents.tg(`🔐 Вхід в адмінку з IP ${ip}`);
      return send(res, 303, '', { 'Set-Cookie': `adm=${newSession(ip)}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESS_DAYS * 86400}`, Location: '/admin' });
    }
    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) return send(res, 404, { error: 'not_found' });   // адмінку не видно, доки не увійшли через LOGIN_PATH
      // захист від підробки запитів: POST в адмінку лише зі сторінок цього ж сайту
      if (req.method === 'POST') { const og = req.headers.origin; if (og && og !== new URL(PUBLIC_URL).origin) { event({ msg: 'адмінка: POST з чужого сайту', origin: og }); return send(res, 403, { error: 'origin' }); } }
      if (p === '/admin/logout-all' && req.method === 'POST') { SESS = {}; saveSess(); event({ msg: 'адмін: вийти на всіх пристроях' });
        return send(res, 303, '', { 'Set-Cookie': 'adm=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0', Location: '/' }); }
      if (p === '/admin' && req.method === 'GET') return send(res, 200, adminPage(u.searchParams.get('q') || '', u.searchParams.get('st') || ''), { 'Cache-Control': 'no-store' });
      if (p === '/admin/test-order' && req.method === 'POST') {   // перевірка кругу оплати без рендеру і без витрат
        const id = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex');
        fs.mkdirSync(odir(id), { recursive: true });
        const o = { id, ...newNo(), key: crypto.randomBytes(16).toString('hex'), childName: 'Milica', nameInput: 'Milica', email: 'test@cestitam.eu', lang: 'uk',
          photo: null, test: true, status: 'awaiting_payment', nameCheck: [], createdAt: new Date().toISOString() };
        log(o, 'створено тестове замовлення з адмінки'); save(o);
        return send(res, 303, '', { Location: `/o/${o.id}/${o.key}` });
      }
      if (p === '/admin/agents' && req.method === 'GET') return send(res, 200, agentsPage(), { 'Cache-Control': 'no-store' });
      if (p === '/admin/support' && req.method === 'GET') return send(res, 200, page('Підтримка · CRM', support.adminPage(esc), 'uk'), { 'Cache-Control': 'no-store' });
      if ((mm = /^\/admin\/support\/(T-\d+)\/(reply|close)$/.exec(p)) && req.method === 'POST') {
        if (mm[2] === 'close') support.closeTicket(mm[1]);
        else { const f = new URLSearchParams((await readBody(req, 12000)).toString('utf8')); await support.operatorReply(mm[1], f.get('text'), 'CRM'); }
        return send(res, 303, '', { Location: '/admin/support' });
      }
      if (p === '/admin/report.json' && req.method === 'GET') return send(res, 200, report.reportFeed(DATA, listOrders(), u.searchParams.get('day')), { 'Cache-Control': 'no-store' });
      if (p === '/admin/agents.json' && req.method === 'GET') return send(res, 200, agents.agentsFeed({ dataDir: DATA, orders: listOrders(), now: NOW, busy, tg: !!(ENV.TG_BOT_TOKEN && ENV.TG_CHAT_ID) }), { 'Cache-Control': 'no-store' });
      if (p === '/admin/export.csv') { event({ msg: 'адмін: експорт CSV' }); return send(res, 200, ordersCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zamovlennya.csv"', 'Cache-Control': 'no-store' }); }
      if ((mm = /^\/admin\/([\w-]+)\/note$/.exec(p)) && req.method === 'POST') {
        const o = load(mm[1]); if (!o) return send(res, 404, {});
        const f = new URLSearchParams((await readBody(req, 4000)).toString('utf8'));
        o.note = String(f.get('note') || '').slice(0, 500); log(o, 'нотатка: ' + o.note); save(o);
        return send(res, 303, '', { Location: '/admin?q=' + (o.no || o.id) });
      }
      if ((mm = /^\/admin\/f\/([\w-]+)\/(book|portrait)\.jpg$/.exec(p))) {   // кадри перевірки відео
        const o = load(mm[1]); const f = o && path.join(odir(o.id), 'out', `qc_${mm[2]}.jpg`);
        if (!f || !fs.existsSync(f)) return send(res, 404, {});
        return send(res, 200, fs.readFileSync(f), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
      }
      if ((mm = /^\/admin\/v\/([\w-]+)\.mp4$/.exec(p))) { const o = load(mm[1]); return o ? streamFile(req, res, path.join(odir(o.id), o.video || 'x')) : send(res, 404, {}); }
      if ((mm = /^\/admin\/([\w-]+)\/(paid|approve|rerender|reject|okcheck)$/.exec(p)) && req.method === 'POST') {
        const o = load(mm[1]); if (!o) return send(res, 404, {});
        const act = mm[2];
        if (act === 'paid') { const f = new URLSearchParams((await readBody(req, 2000)).toString('utf8'));
          const amt = Number(String(f.get('amount') || '').replace(',', '.')); if (amt > 0) o.amount = amt; o.payMethod = String(f.get('method') || '').slice(0, 20);
          o.status = 'queued'; o.paidAt = new Date().toISOString(); notify(o, `💰 Оплачено ${o.amount || ''} ${o.payMethod}`); }
        if (act === 'approve') { o.status = 'sent'; o.sentAt = new Date().toISOString(); await emailCustomer(o); }
        if (act === 'rerender') { o.status = 'queued'; o.attempts = 0; delete o.error; }
        if (act === 'reject') o.status = 'rejected';
        if (act === 'okcheck' && o.status === 'hold') { o.checkOk = true; o.status = 'queued'; event({ order: o.id, no: o.no, name: o.childName, agent: 'orders', ok: true, msg: 'ви дали OK, замовлення пішло в рендер' }); }
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
