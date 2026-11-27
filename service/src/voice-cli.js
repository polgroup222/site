#!/usr/bin/env node
'use strict';
// node src/voice-cli.js Stefan Milica "Đorđe"          -> лише кошторис, БЕЗ витрат
// node src/voice-cli.js Stefan --yes                    -> генерує (тільки після погодження власника)
const { resolveName } = require('./names');
const { estimate, getSlotAudio } = require('./voice');

(async () => {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const names = args.filter(a => !a.startsWith('--'));
  if (!names.length) { console.log('Вкажи імена: node src/voice-cli.js Stefan Milica [--yes]'); process.exit(1); }
  let total = 0;
  const rows = names.map(n => { const r = resolveName(n); if (!r.ok) return { n, r }; const e = estimate(r.tts_vocative); total += e.total; return { n, r, e }; });
  for (const { n, r, e } of rows) {
    if (!r.ok) { console.log(`✗ ${n}: ${r.error}`); continue; }
    console.log(`${r.nominative} → ${r.vocative}${r.needsReview ? '  [перевірити: ' + r.reviewReasons.join(', ') + ']' : ''}  ${e.total} симв.`);
    for (const s of Object.values(e.texts)) console.log(`   «${s.text}»`);
  }
  console.log(`\nРазом до списання: ${total} символів ElevenLabs.`);
  if (!yes) { console.log('Генерацію НЕ запущено. Додай --yes, щоб озвучити.'); return; }
  for (const { r } of rows) if (r && r.ok) { const out = await getSlotAudio(r.tts_vocative, { allowSpend: true }); console.log(`✓ ${r.nominative}: ${out.cached ? 'з кешу' : out.charsSpent + ' симв.'} → ${Object.values(out.files).join(', ')}`); }
})().catch(e => { console.error(e.message); process.exit(1); });
