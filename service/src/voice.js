'use strict';
// Озвучка 2 слотів для одного імені з кешем. Ключі тільки з env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'tts.json'), 'utf8'));
const CACHE_DIR = process.env.VOICE_CACHE_DIR || path.join(__dirname, '..', 'cache', 'voice');

function slotTexts(ttsVocative, only) {
  return Object.fromEntries(Object.entries(CONFIG.slots).filter(([k]) => !only || only.includes(k)).map(([k, s]) => [k, { ...s, text: s.text.replace('{V}', ttsVocative) }]));
}
function settingsHash() {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify([CONFIG.model_id, CONFIG.output_format, CONFIG.voice_settings, CONFIG.seed, CONFIG.slots, process.env.ELEVENLABS_VOICE_ID || '']));
  return h.digest('hex').slice(0, 10);
}
function cachePaths(ttsVocative) {
  const safe = ttsVocative.normalize('NFC').toLowerCase().replace(/[^\p{L}\-]+/gu, '_');
  const dir = path.join(CACHE_DIR, settingsHash(), safe);
  return { dir, files: Object.fromEntries(Object.keys(CONFIG.slots).map(k => [k, path.join(dir, `${k}.mp3`)])) };
}

/** Скільки символів буде списано (оплачується лише text, не previous/next_text). */
function estimate(ttsVocative, only) {
  const t = slotTexts(ttsVocative, only);
  const { files } = cachePaths(ttsVocative);
  const perSlot = Object.fromEntries(Object.entries(t).map(([k, s]) => [k, fs.existsSync(files[k]) ? 0 : s.text.length]));
  return { perSlot, total: Object.values(perSlot).reduce((a, b) => a + b, 0), texts: t };
}

async function ttsRequest(slot) {
  const key = process.env.ELEVENLABS_API_KEY, voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID не задані в середовищі');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${CONFIG.output_format}`;
  const body = { text: slot.text, model_id: CONFIG.model_id, voice_settings: CONFIG.voice_settings, seed: CONFIG.seed };
  if (slot.previous_text) body.previous_text = slot.previous_text;
  if (slot.next_text) body.next_text = slot.next_text;
  const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Повертає шляхи до slot1.mp3 / slot2.mp3. Якщо файли є в кеші, нічого не генерує.
 * allowSpend:false (за замовчуванням) кидає помилку замість витрати кредитів.
 */
async function getSlotAudio(ttsVocative, { allowSpend = false, only } = {}) {
  const est = estimate(ttsVocative, only);
  const { dir, files } = cachePaths(ttsVocative);
  if (est.total === 0) return { files, charsSpent: 0, cached: true };
  if (est.total > CONFIG.max_chars_per_order) throw new Error(`Ліміт символів на замовлення: ${est.total} > ${CONFIG.max_chars_per_order}`);
  if (!allowSpend) { const e = new Error(`Потрібна генерація ${est.total} символів, але allowSpend=false`); e.estimate = est; throw e; }
  fs.mkdirSync(dir, { recursive: true });
  let spent = 0;
  for (const [k, s] of Object.entries(est.texts)) {
    if (fs.existsSync(files[k])) continue;
    const buf = await ttsRequest(s);
    fs.writeFileSync(files[k] + '.tmp', buf); fs.renameSync(files[k] + '.tmp', files[k]);
    spent += s.text.length;
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ttsVocative, model: CONFIG.model_id, settings: CONFIG.voice_settings, createdAt: new Date().toISOString(), texts: est.texts }, null, 2));
  return { files, charsSpent: spent, cached: false };
}

module.exports = { getSlotAudio, estimate, slotTexts, CONFIG };
