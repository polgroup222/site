'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.TG_BOT_TOKEN = ''; process.env.ANTHROPIC_API_KEY = ''; process.env.SUPPORT_DAILY_USD = '1';
const s = require('../server/support');
const sent = [];
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-'));
s.init({ dataDir: D, tg: async (m) => { sent.push(m); return true; }, publicUrl: 'https://x', loadOrder: () => null });

test('номер звернення розпізнається в різних формах', () => {
  for (const v of ['T-0042', 't-42', '#T-0042', '42', 'T42']) assert.strictEqual(s.normId(v), 'T-0042');
  assert.strictEqual(s.normId('abc'), null);
});
test('ціна відповіді Haiku 5.5', () => {
  const c = s.costOf({ input_tokens: 3000, output_tokens: 200 });
  assert.ok(Math.abs(c - (3000 * 0.1 + 200 * 0.5) / 1e6) < 1e-12);
  assert.ok(s.costOf({ cache_read_input_tokens: 3000 }) < s.costOf({ input_tokens: 3000 }));
});
test('без ключа AI не викликається, клієнту пропонуємо оператора', async () => {
  const r = await s.chat({ history: [{ role: 'user', text: 'Koliko se čeka?' }], lang: 'sr-Latn', ip: '1.1.1.1' });
  assert.strictEqual(r.off, true); assert.strictEqual(r.operator, true);
});
test('звернення -> Telegram -> /reply -> клієнт бачить відповідь', async () => {
  const r = s.createTicket({ name: 'Marko', email: 'marko@example.com', text: 'Gde je video?', lang: 'sr-Latn', ip: '2.2.2.2' });
  assert.match(r.id, /^T-\d{4}$/);
  assert.match(sent.at(-1), /Marko/); assert.match(sent.at(-1), /marko@example.com/); assert.match(sent.at(-1), new RegExp('#' + r.id));
  const ans = await s.handleCommand(`/reply ${r.id} Video je spreman za 10 minuta.`);
  assert.match(ans, /надіслано/);
  const t = s.getTicket(r.id, r.key);
  assert.strictEqual(t.messages.at(-1).from, 'operator'); assert.strictEqual(t.status, 'answered');
  assert.strictEqual(s.getTicket(r.id, 'f'.repeat(32)), null);
  // «Відповісти» на повідомлення бота
  await s.handleCommand('Hvala, još nešto', sent.at(-1));
  assert.strictEqual(s.getTicket(r.id, r.key).messages.length, 3);
  assert.match(await s.handleCommand('/tickets'), new RegExp(r.id));
  assert.match(await s.handleCommand(`/close ${r.id}`), /закрито/);
});
test('без email звернення не приймаємо', () => {
  assert.strictEqual(s.createTicket({ name: 'A', email: 'nope', text: 'x', ip: '3.3.3.3' }).error, 'email');
});
test('чужі повідомлення в боті ігноруються', async () => {
  assert.strictEqual(await s.handleCommand('привіт'), null);
});
test('попередження про ліміт у CRM', () => {
  fs.writeFileSync(path.join(D, 'support', 'usage.json'), JSON.stringify({ day: s.usage().day, usd: 0.85, calls: 10 }));
  assert.ok(s.problems().some(p => /80%/.test(p.text)));
});
