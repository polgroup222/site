'use strict';
// Нормалізація сербського імені та кличний відмінок (vokativ). Без мережі, без витрат.
const fs = require('fs');
const path = require('path');

const CYR = { 'љ':'lj','њ':'nj','џ':'dž','а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'đ','е':'e','ж':'ž','з':'z','и':'i','ј':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','ћ':'ć','у':'u','ф':'f','х':'h','ц':'c','ч':'č','ш':'š' };
const FOLD = { 'č':'c','ć':'c','š':'s','ž':'z','đ':'dj' };

function cyrToLat(s) {
  return [...s].map(ch => {
    const low = ch.toLowerCase();
    if (!(low in CYR)) return ch;
    const lat = CYR[low];
    return ch === low ? lat : lat[0].toUpperCase() + lat.slice(1);
  }).join('');
}
// ключ для пошуку без діакритики: "Đorđe" -> "djordje", "Dordje" теж -> "dordje" (дод. варіант нижче)
function foldKey(s) {
  return s.toLowerCase().replace(/[čćšžđ]/g, c => FOLD[c]).replace(/[^a-z\- ]/g, '');
}
function capitalize(s) {
  return s.toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

function loadDictionary(dataDir = path.join(__dirname, '..', 'data')) {
  const dict = new Map(); // foldKey -> {nominative, vocative?, gender_hint, tts_text, source}
  const add = (rec) => {
    const k = foldKey(rec.nominative);
    if (!dict.has(k)) dict.set(k, rec);
    const k2 = k.replace(/dj/g, 'd'); // "Dordje", "Andela"
    if (!dict.has(k2)) dict.set(k2, rec);
  };
  const known = fs.readFileSync(path.join(dataDir, 'names_known.csv'), 'utf8').trim().split('\n').slice(1);
  for (const line of known) {
    const [nominative, vocative, gender_hint, tts_text] = line.split(',');
    add({ nominative, vocative, gender_hint, tts_text: tts_text || '', source: 'known' });
  }
  let g = '';
  for (const line of fs.readFileSync(path.join(dataDir, 'names_common.txt'), 'utf8').split('\n')) {
    if (line.startsWith('#')) { g = line.includes('f') ? 'f' : 'm'; continue; }
    for (const n of line.split(/\s+/).filter(Boolean)) add({ nominative: n, gender_hint: g, tts_text: '', source: 'common' });
  }
  return dict;
}

const VOWELS = 'aeiou';
// Правила кличного відмінка для одного слова
function vocativeRule(word, gender) {
  const w = word;
  const lower = w.toLowerCase();
  if (/ica$/.test(lower)) return { v: w.slice(0, -1) + 'e', sure: true };      // Milica -> Milice, Jovica -> Jovice
  if (VOWELS.includes(lower.slice(-1))) return { v: w, sure: true };            // Ana, Luka, Đorđe, Marko, Laki
  if (gender === 'f') return { v: w, sure: false };                              // Ines, Karmen (рідкісні)
  if (/j$/.test(lower)) return { v: w + 'u', sure: true };                        // Andrej -> Andreju
  if (/k$/.test(lower)) return { v: w.slice(0, -1) + 'če', sure: false };         // Vuk -> Vuče (іноземні треба перевірити)
  if (/g$/.test(lower)) return { v: w.slice(0, -1) + 'že', sure: false };
  if (/h$/.test(lower)) return { v: w.slice(0, -1) + 'še', sure: false };
  if (/c$/.test(lower)) return { v: w.slice(0, -1) + 'če', sure: false };
  return { v: w + 'e', sure: true };                                              // Stefan -> Stefane, Uroš -> Uroše
}

const NAME_RE = /^[\p{L}][\p{L}\- ]{0,28}[\p{L}]$/u;

/**
 * resolveName("  dusan ") -> { nominative:"Dušan", vocative:"Dušane", needsReview:false, ... }
 * nominative пишемо на папері, vocative озвучуємо.
 */
function resolveName(input, dict = loadDictionary()) {
  const raw = String(input || '').normalize('NFC').trim().replace(/\s+/g, ' ');
  const lat = cyrToLat(raw);
  if (!NAME_RE.test(lat)) return { ok: false, error: 'invalid_name', input: raw };
  const rec = dict.get(foldKey(lat)) || dict.get(foldKey(lat).replace(/dj/g, 'd'));
  const reasons = [];
  let nominative, vocative, gender = '', tts = '', source;
  if (rec) {
    nominative = rec.nominative; gender = rec.gender_hint; tts = rec.tts_text; source = rec.source;
    vocative = rec.vocative || nominative.split(/([\s\-])/).map(p => /[\s\-]/.test(p) ? p : vocativeRule(p, gender).v).join('');
  } else {
    nominative = capitalize(lat); source = 'rule';
    const parts = nominative.split(/([\s\-])/);
    let sure = true;
    vocative = parts.map(p => { if (/[\s\-]/.test(p)) return p; const r = vocativeRule(p, ''); sure = sure && r.sure; return r.v; }).join('');
    reasons.push('name_not_in_dictionary');
    if (!sure) reasons.push('vocative_uncertain');
  }
  return { ok: true, input: raw, nominative, vocative, tts_vocative: tts || vocative, gender_hint: gender, source, needsReview: reasons.length > 0, reviewReasons: reasons };
}

module.exports = { resolveName, loadDictionary, vocativeRule, cyrToLat, foldKey };
