'use strict';
// Сервер замовлень: прийом (ім'я + фото + email) -> черга -> рендер -> перевірка -> лист клієнту з посиланням.
// Без зовнішніх залежностей: лише Node 18+, ffmpeg, ImageMagick, Python (див. Dockerfile).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveName } = require('../src/names');
const { renderMaster } = require('../src/render-master');
const { spawnSync } = require('child_process');

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
const log = (o, msg) => { (o.log ||= []).push(`${new Date().toISOString()} ${msg}`); };

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
function photoExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(4, 12).toString().match(/ftyp(heic|heix|mif1|msf1|hevc)/)) return 'heic';
  return null;
}

// ---------- лист клієнту (Resend, якщо є ключ) ----------
const T = {
  'sr-Latn': { subj: 'Vaša čestitka od Deda Mraza je spremna ✦', body: (n, u) => `Zdravo!\n\nČestitka za ${n} je spremna. Pogledajte i preuzmite je ovde:\n${u}\n\nSrećni praznici!\nZimska pošta` },
  'sr-Cyrl': { subj: 'Ваша честитка од Деда Мраза је спремна ✦', body: (n, u) => `Здраво!\n\nЧеститка за ${n} је спремна. Погледајте и преузмите је овде:\n${u}\n\nСрећни празници!\nЗимска пошта` },
  uk: { subj: 'Ваше відеопривітання готове ✦', body: (n, u) => `Вітаємо!\n\nПривітання для ${n} готове. Переглянути і завантажити:\n${u}\n\nЗі святами!\nЗимова пошта` },
};
async function emailCustomer(o) {
  const url = `${PUBLIC_URL}/o/${o.id}/${o.key}`;
  if (!ENV.RESEND_API_KEY || !ENV.MAIL_FROM) { log(o, `email: ключа нема, посилання для ручної відправки ${url}`); return false; }
  const t = T[o.lang] || T['sr-Latn'];
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: ENV.MAIL_FROM, to: [o.email], subject: t.subj, text: t.body(o.childName, url) }) });
  log(o, `email ${r.ok ? 'надіслано' : 'помилка ' + r.status}`); return r.ok;
}

// ---------- воркер: одне замовлення за раз ----------
let busy = false;
async function tick() {
  if (busy) return;
  const o = listOrders().reverse().find(x => x.status === 'queued');
  if (!o) return;
  busy = true;
  o.status = 'rendering'; o.attempts = (o.attempts || 0) + 1; log(o, 'рендер почато'); save(o);
  try {
    const r = await renderMaster({ id: 'video', name: o.childName, photo: path.join(odir(o.id), o.photo), master: MASTER,
      outDir: path.join(odir(o.id), 'out'), allowSpend: true, voiceFile: o.voiceFile });
    o.result = { status: r.status, reviewReasons: r.reviewReasons, renderSeconds: r.renderSeconds, voice: r.voice };
    o.video = 'out/video.mp4';
    // легка копія для клієнта: ~50–60 МБ, H.264 High, faststart (відтворюється одразу на телефоні)
    const src = path.join(odir(o.id), o.video), web = path.join(odir(o.id), 'out', 'web.mp4');
    const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', web]);
    if (enc.status === 0) { o.web = 'out/web.mp4'; o.webMB = Math.round(fs.statSync(web).size / 1e5) / 10; } else log(o, 'web-копія: помилка ' + String(enc.stderr).slice(0, 200));
    // проміжні великі файли не тримаємо
    for (const f of ['portrait_overlay.mkv']) fs.rmSync(path.join(odir(o.id), 'out', f), { force: true });
    if (r.status === 'done' && AUTO_SEND) { o.status = 'sent'; await emailCustomer(o); }
    else o.status = 'review';
    log(o, `рендер готовий: ${r.status} ${r.reviewReasons.join(',')}`);
  } catch (e) {
    o.status = o.attempts >= 2 ? 'failed' : 'queued'; o.error = String(e.message || e).slice(0, 2000); log(o, 'помилка: ' + o.error.slice(0, 300));
  }
  save(o); busy = false; setImmediate(tick);
}
// після перезапуску: незавершені рендери повертаємо в чергу
for (const o of listOrders()) if (o.status === 'rendering') { o.status = 'queued'; log(o, 'перезапуск сервера'); save(o); }
setInterval(tick, 5000);

// ---------- приватність: автоматичне видалення ----------
const daysSince = (t) => t ? (Date.now() - Date.parse(t)) / 864e5 : 0;
function purge() {
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
  'sr-Latn': { title: 'Čestitka za', st: { awaiting_payment: 'Čeka uplatu', queued: 'U redu za izradu', rendering: 'Deda Mraz upravo snima', review: 'Proveravamo svaki detalj', sent: 'Spremno!', failed: 'Došlo je do greške, javićemo vam se', rejected: 'Otkazano' },
    eta: (m) => `Otprilike još ${m} min. Stranica se sama osvežava.`, pay: 'Čim uplata bude potvrđena, počinjemo izradu.', mail: 'Poslaćemo vam i email kada bude spremno.',
    dl: 'Preuzmi video', share: 'Podeli', copy: 'Kopiraj link', copied: 'Link je kopiran', gone: 'Video je obrisan nakon isteka roka čuvanja.', keep: (d) => `Video čuvamo ${d} dana. Preuzmite ga na vreme.`, steps: ['Porudžbina', 'Izrada', 'Provera', 'Spremno'] },
  uk: { title: 'Привітання для', st: { awaiting_payment: 'Чекаємо оплату', queued: 'У черзі', rendering: 'Дід Мороз записує привітання', review: 'Перевіряємо кожну деталь', sent: 'Готово!', failed: 'Сталася помилка, ми зв’яжемося з вами', rejected: 'Скасовано' },
    eta: (m) => `Приблизно ще ${m} хв. Сторінка оновлюється сама.`, pay: 'Щойно оплату підтвердимо, почнемо створення.', mail: 'Коли буде готово, ми також надішлемо лист.',
    dl: 'Завантажити відео', share: 'Поділитися', copy: 'Скопіювати посилання', copied: 'Посилання скопійовано', gone: 'Відео видалено після завершення терміну зберігання.', keep: (d) => `Відео зберігаємо ${d} днів. Завантажте його вчасно.`, steps: ['Замовлення', 'Створення', 'Перевірка', 'Готово'] },
};
CT['sr-Cyrl'] = CT['sr-Latn'];
const ST = CT['sr-Latn'].st;
function eta(o) {
  if (o.status === 'rendering') return Math.max(2, Math.round(AVG_RENDER_MIN - (Date.now() - Date.parse(o.updatedAt)) / 60e3));
  if (o.status !== 'queued') return null;
  const q = listOrders().filter(x => x.status === 'queued').reverse(); const pos = q.findIndex(x => x.id === o.id);
  return (pos + 1 + (busy ? 1 : 0)) * AVG_RENDER_MIN;
}
function customerPage(o) {
  const t = CT[o.lang] || CT['sr-Latn'], ready = o.status === 'sent' && !o.videoPurged;
  const step = { awaiting_payment: 0, queued: 1, rendering: 1, review: 2, sent: 4 }[o.status] ?? 0;
  const m = eta(o), base = `/o/${o.id}/${o.key}`;
  const steps = t.steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"><span>${i < step ? '✓' : i + 1}</span>${esc(s)}</li>`).join('');
  const body = ready
    ? `<video controls playsinline preload="metadata" src="${base}/video.mp4"></video>
<div class="actions"><a class="b" href="${base}/video.mp4?dl=1">⬇ ${esc(t.dl)}</a><button class="b ghost" id="share">↗ ${esc(t.share)}</button><button class="b ghost" id="copy">⧉ ${esc(t.copy)}</button></div>
<p class="muted">${esc(t.keep(KEEP_VIDEO_DAYS))}</p>`
    : o.videoPurged ? `<p>${esc(t.gone)}</p>`
    : `<div class="wait"><div class="flake">❄</div><p class="big">${esc(t.st[o.status] || o.status)}</p>${m ? `<p class="muted">${esc(t.eta(m))}</p>` : ''}
${o.status === 'awaiting_payment' ? `<p class="muted">${esc(t.pay)}</p>` : ''}<p class="muted">${esc(t.mail)}</p></div>`;
  const live = !ready && !o.videoPurged && !['failed', 'rejected'].includes(o.status);
  return page('Zimska pošta', `<header class="top"><span class="logo">✳ Zimska pošta</span></header>
<h1><small>${esc(t.title)}</small>${esc(o.childName)}</h1><ol class="steps">${steps}</ol><section class="card">${body}</section>
${live ? '<script nonce="r">setTimeout(()=>location.reload(),30000)</script>' : ''}
${ready ? `<script nonce="r">const u=location.href.split('#')[0];document.getElementById('share').onclick=()=>navigator.share?navigator.share({title:document.title,url:u}).catch(()=>{}):navigator.clipboard.writeText(u);
document.getElementById('copy').onclick=e=>navigator.clipboard.writeText(u).then(()=>{e.target.textContent=${JSON.stringify('✓ ' + t.copied)}});</script>` : ''}`, o.lang);
}
function adminPage() {
  const rows = listOrders().slice(0, 200).map(o => `<div class="card"><b>${esc(o.childName)}</b> <span class="tag">${esc(o.status)}</span> <span class="muted">${esc(o.email)} · ${esc(o.createdAt)} · ${esc(o.id)}</span>
${o.webMB ? `<span class="muted">клієнту: ${o.webMB} МБ</span>` : ""}${o.result?.reviewReasons?.length ? `<p class="muted">Зауваження: ${esc(o.result.reviewReasons.join(', '))}</p>` : ''}${o.error ? `<p class="muted">Помилка: ${esc(o.error.slice(0, 400))}</p>` : ''}
${o.video && fs.existsSync(path.join(odir(o.id), o.video)) ? `<video controls preload="none" src="/admin/v/${o.id}.mp4"></video>` : ''}
<p>${['awaiting_payment'].includes(o.status) ? btn(o, 'paid', 'Оплачено → у чергу') : ''}${['review', 'sent'].includes(o.status) ? btn(o, 'approve', o.status === 'sent' ? 'Надіслати ще раз' : 'Підтвердити і надіслати') : ''}
${['review', 'failed', 'sent'].includes(o.status) ? btn(o, 'rerender', 'Перерендерити') : ''}${o.status !== 'rejected' ? btn(o, 'reject', 'Скасувати') : ''}
<a class="muted" href="/o/${o.id}/${o.key}">сторінка клієнта</a></p></div>`).join('');
  return page('Адмінка', `<h1>Замовлення</h1><p class="muted">Оплата: ${PAYMENT_MODE}, автонадсилання: ${AUTO_SEND ? 'так' : 'ні (після перевірки)'}</p>${rows || '<p>Поки порожньо.</p>'}`);
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

    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, busy, queued: listOrders().filter(o => o.status === 'queued').length });

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
      const o = { id, key: crypto.randomBytes(16).toString('hex'), childName: nm.nominative, nameInput: name, email,
        lang: ['uk', 'sr-Latn', 'sr-Cyrl'].includes(body.lang) ? body.lang : 'sr-Latn', photo: `photo.${ext}`,
        status: PAYMENT_MODE === 'none' ? 'queued' : 'awaiting_payment', nameCheck: nm.needsReview ? nm.reviewReasons : [], createdAt: new Date().toISOString() };
      log(o, 'створено'); save(o); setImmediate(tick);
      return send(res, 201, { id, status: o.status, url: `${PUBLIC_URL}/o/${id}/${o.key}` });
    }

    let mm;
    if ((mm = /^\/o\/([\w-]+)\/([a-f0-9]{32})(\/video\.mp4)?$/.exec(p))) {
      const o = load(mm[1]); if (!o || !safeEq(o.key, mm[2])) return send(res, 404, page('Nije pronađeno', '<h1>Nije pronađeno</h1>'));
      if (!mm[3]) return send(res, 200, customerPage(o));
      if (o.status !== 'sent') return send(res, 404, { error: 'not_ready' });
      if (o.videoPurged) return send(res, 410, { error: 'expired' });
      return streamFile(req, res, path.join(odir(o.id), o.web || o.video), u.searchParams.has('dl'));
    }

    // адмінка
    if (p === '/admin/login' && req.method === 'GET') {
      const t = u.searchParams.get('token') || '';
      if (!ADMIN_TOKEN || !safeEq(crypto.createHash('sha256').update(t).digest('hex'), crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex'))) return send(res, 403, page('Ні', '<h1>Доступ заборонено</h1>'));
      return send(res, 302, '', { 'Set-Cookie': `adm=${crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex')}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=2592000`, Location: '/admin' });
    }
    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) return send(res, 403, page('Ні', '<h1>Увійдіть через /admin/login?token=…</h1>'));
      if (p === '/admin' && req.method === 'GET') return send(res, 200, adminPage());
      if ((mm = /^\/admin\/v\/([\w-]+)\.mp4$/.exec(p))) { const o = load(mm[1]); return o ? streamFile(req, res, path.join(odir(o.id), o.video || 'x')) : send(res, 404, {}); }
      if ((mm = /^\/admin\/([\w-]+)\/(paid|approve|rerender|reject)$/.exec(p)) && req.method === 'POST') {
        const o = load(mm[1]); if (!o) return send(res, 404, {});
        const act = mm[2];
        if (act === 'paid') { o.status = 'queued'; o.paidAt = new Date().toISOString(); }
        if (act === 'approve') { o.status = 'sent'; o.sentAt = new Date().toISOString(); await emailCustomer(o); }
        if (act === 'rerender') { o.status = 'queued'; o.attempts = 0; delete o.error; delete o.web; }
        if (act === 'reject') o.status = 'rejected';
        log(o, 'адмін: ' + act); save(o); setImmediate(tick);
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
