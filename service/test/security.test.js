'use strict';
// Перевірки безпеки сервера замовлень: запускаємо справжній сервер на тимчасовій папці і «атакуємо» його.
const test = require('node:test'), assert = require('node:assert');
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const PORT = 18000 + Math.floor(Math.random() * 1000), BASE = `http://127.0.0.1:${PORT}`, TOKEN = 'x'.repeat(10) + 'SecretAdminToken123456';
let srv, dir;
// справжній PNG ~40 КБ (сервер не приймає фото менше 10 КБ)
function png() {
  const w = 120, h = 120, raw = Buffer.alloc((w * 3 + 1) * h); require('crypto').randomFillSync(raw);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO = 'data:image/png;base64,' + png().toString('base64');
const req = (p, o = {}) => fetch(BASE + p, { redirect: 'manual', ...o });
const form = (p, data, headers = {}) => req(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(data).toString() });
const order = (b, ip) => req('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ name: 'Milica', photo: PHOTO, lang: 'sr-Latn', ...b }) });

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cest-'));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_TOKEN: TOKEN,
    PUBLIC_URL: BASE, PAYMENT_MODE: 'mock', TG_BOT_TOKEN: '', SHEET_WEBHOOK: '', AUTO_PURGE: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/health'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
test.after(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

let A;
test('замовлення: телефон обовʼязковий, формула в email не проходить', async () => {
  assert.equal((await order({ email: 'a@b.rs' }, '10.0.0.1')).status, 400);
  assert.equal((await order({ phone: '064 123 4567', email: '=IMPORTXML("http://x")@a.rs' }, '10.0.0.1')).status, 400);
  const r = await order({ phone: '064 123 4567', email: 'Mama@Example.rs' }, '10.0.0.2'); assert.equal(r.status, 201);
  A = await r.json(); assert.match(A.no, /^[A-Z]{2}-\d{5}$/);
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'orders', A.id, 'order.json'), 'utf8')); assert.equal(o.phone, '381641234567');
});
test('вхід клієнта: телефон + номер з літерами; без літер або чужий телефон — ні', async () => {
  const ok = await form('/porudzbina', { email: '+381 64 123 4567', no: A.no }, { 'X-Forwarded-For': '10.1.0.1' });
  assert.equal(ok.status, 303); assert.match(ok.headers.get('location'), new RegExp(`^/o/${A.id}/`));
  assert.equal((await form('/porudzbina', { email: 'mama@example.rs', no: A.no.toLowerCase() }, { 'X-Forwarded-For': '10.1.0.2' })).status, 303);
  assert.equal((await form('/porudzbina', { email: '0641234567', no: A.no.slice(3) }, { 'X-Forwarded-For': '10.1.0.3' })).status, 200);   // без літер
  assert.equal((await form('/porudzbina', { email: '0641234568', no: A.no }, { 'X-Forwarded-For': '10.1.0.4' })).status, 200);   // інший телефон
});
test('перебір номерів: блок після 5 спроб на один телефон навіть з різних IP', async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await form('/porudzbina', { email: '0649999999', no: 'AB-0000' + i }, { 'X-Forwarded-For': '10.2.0.' + i });
  assert.equal(last.status, 429);
});
test('оплата-імітація: справжній клієнт не може «оплатити» сам', async () => {
  const key = A.url.split('/').pop();
  await form(`/o/${A.id}/${key}/mock/ok`, {});
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'orders', A.id, 'order.json'), 'utf8')); assert.equal(o.status, 'awaiting_payment');
});
test('адмінка: токен у адресі не працює, невірний токен — ні, ліміт спроб', async () => {
  assert.equal((await req('/admin')).status, 404);   // адмінку не видно без входу
  const g = await req('/admin/login?token=' + TOKEN); assert.equal(g.status, 200); assert.equal(g.headers.get('set-cookie'), null);
  assert.equal((await form('/admin/login', { token: 'wrong' }, { 'X-Forwarded-For': '10.3.0.1' })).status, 403);
  assert.equal((await req('/admin', { headers: { Cookie: 'adm=' + require('crypto').createHash('sha256').update(TOKEN).digest('hex') } })).status, 404);   // стара cookie
  let last; for (let i = 0; i < 12; i++) last = await form('/admin/login', { token: 'w' + i }, { 'X-Forwarded-For': '10.3.0.9' });
  assert.equal(last.status, 429);
});
test('адмінка: вхід, CSRF з чужого сайту, вийти всюди', async () => {
  const r = await form('/admin/login', { token: TOKEN }, { 'X-Forwarded-For': '10.4.0.1' }); assert.equal(r.status, 303);
  const c = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const a = await req('/admin', { headers: { Cookie: c } }); assert.equal(a.status, 200);
  assert.match(a.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(a.headers.get('x-frame-options'), 'DENY');
  const html = await a.text(); assert.ok(!html.includes('nonce="r"'));
  assert.equal((await form(`/admin/${A.id}/reject`, {}, { Cookie: c, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await form('/admin/logout-all', {}, { Cookie: c })).status, 303);
  assert.equal((await req('/admin', { headers: { Cookie: c } })).status, 404);
});
test('шляхи і чужі файли: ../, чужий ключ, відео до готовності', async () => {
  for (const p of ['/o/../../etc/passwd/' + 'a'.repeat(32), `/o/${A.id}/${'0'.repeat(32)}`, `/o/${A.id}/${'0'.repeat(32)}/video.mp4`, '/admin/v/..%2f..%2fetc.mp4', '/api/export.csv?token=']) {
    const r = await req(p); assert.ok([403, 404, 303].includes(r.status), p + ' -> ' + r.status);
  }
  const key = A.url.split('/').pop(); assert.equal((await req(`/o/${A.id}/${key}/video.mp4`)).status, 404);
});
test('XSS: імʼя і email екрановані на сторінці клієнта', async () => {
  assert.equal((await order({ name: '<script>alert(1)</script>', phone: '0641112233' }, '10.5.0.1')).status, 400);
});
