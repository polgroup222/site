'use strict';
// Віджет підтримки для сайту й сторінки замовлення: GET /api/support/widget.js
// Shadow DOM, щоб стилі сайту й віджета не заважали одне одному. Мова — з <html lang>, змінюється разом із сайтом.
function cyr(s){const p={'DŽ':'Џ','Dž':'Џ','dž':'џ','LJ':'Љ','Lj':'Љ','lj':'љ','NJ':'Њ','Nj':'Њ','nj':'њ','A':'А','B':'Б','C':'Ц','Č':'Ч','Ć':'Ћ','D':'Д','Đ':'Ђ','E':'Е','F':'Ф','G':'Г','H':'Х','I':'И','J':'Ј','K':'К','L':'Л','M':'М','N':'Н','O':'О','P':'П','R':'Р','S':'С','Š':'Ш','T':'Т','U':'У','V':'В','Z':'З','Ž':'Ж','a':'а','b':'б','c':'ц','č':'ч','ć':'ћ','d':'д','đ':'ђ','e':'е','f':'ф','g':'г','h':'х','i':'и','j':'ј','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п','r':'р','s':'с','š':'ш','t':'т','u':'у','v':'в','z':'з','ž':'ж'};
  return s.replace(/(\b(?:Full HD|TV|JPG|PNG|HEIC|MB|email|Čestitam|AI)\b)|DŽ|Dž|dž|LJ|Lj|lj|NJ|Nj|nj|[A-Za-zČĆĐŠŽčćđšž]/g,(m,keep)=>keep||(p[m]||m));}

const W = {
  'sr-Latn': {
    open: 'Pomoć', title: 'Pomoć · Čestitam', sub: 'Odgovaramo na pitanja o čestitki i porudžbini',
    hello: 'Zdravo! Pitajte me o čestitki od Deda Mraza ili o vašoj porudžbini. Izaberite pitanje ispod ili napišite svoje.',
    helloOrder: 'Zdravo! Tu sam za pitanja o ovoj porudžbini. Pitajte, na primer, kada će video biti spreman.',
    ph: 'Napišite pitanje…', send: 'Pošalji', op: 'Pišite operateru', opTitle: 'Poruka operateru',
    opHint: 'Operater će vam odgovoriti uskoro. Odgovor ćete videti ovde, u ovom četu.',
    name: 'Vaše ime', email: 'Vaš email', text: 'Vaša poruka', opSend: 'Pošalji operateru', back: '← Nazad',
    sent: (id) => `Poruka je poslata (broj ${id}). Operater će vam odgovoriti uskoro, a odgovor ćete videti ovde.`,
    opLabel: 'Operater', you: 'Vi', ticket: (id) => `Razgovor sa operaterom · ${id}`, more: 'Dopišite operateru…', newQ: 'Nazad na pitanja',
    err: 'Nije poslato. Proverite internet i pokušajte ponovo.', eEmail: 'Proverite email adresu.', eMany: 'Previše poruka. Pokušajte malo kasnije.',
    whereVideo: 'Kada će video biti spreman?', typing: 'Pišem…', close: 'Zatvori',
    faq: [
      ['Koliko se čeka na video?', 'Obično 15 do 30 minuta posle uplate. U danima pred Novu godinu može potrajati do nekoliko sati.'],
      ['Šta ako ime deteta nije uobičajeno?', 'Svako ime proveravamo ručno pre slanja. Ako izgovor nije dobar, ispravićemo ga ili ćemo vam se javiti.'],
      ['Koja fotografija je najbolja?', 'Portret izbliza na kom lice zauzima veći deo slike, dobro osvetljen, bez naočara za sunce i bez drugih ljudi. Fotografija iz daljine ispadne mutna u ramu.'],
      ['Šta radite sa fotografijom?', 'Koristimo je samo za vaš video. Fotografiju brišemo 30 dana posle slanja, a video posle 60 dana.'],
      ['Na kom jeziku govori Deda Mraz?', 'Na srpskom. Ime izgovara u vokativu, kako se dete i doziva: Milice, Luka, Đorđe.'],
    ],
  },
  uk: {
    open: 'Допомога', title: 'Допомога · Čestitam', sub: 'Відповідаємо на запитання про привітання й замовлення',
    hello: 'Вітаю! Запитайте мене про привітання від Діда Мороза або про ваше замовлення. Оберіть запитання нижче або напишіть своє.',
    helloOrder: 'Вітаю! Я тут, щоб допомогти з цим замовленням. Запитайте, наприклад, коли буде готове відео.',
    ph: 'Напишіть запитання…', send: 'Надіслати', op: 'Написати оператору', opTitle: 'Повідомлення оператору',
    opHint: 'Оператор скоро відповість. Відповідь ви побачите тут, у цьому чаті.',
    name: 'Ваше ім’я', email: 'Ваш email', text: 'Ваше повідомлення', opSend: 'Надіслати оператору', back: '← Назад',
    sent: (id) => `Повідомлення надіслано (номер ${id}). Оператор скоро відповість, відповідь з’явиться тут.`,
    opLabel: 'Оператор', you: 'Ви', ticket: (id) => `Розмова з оператором · ${id}`, more: 'Допишіть оператору…', newQ: 'Назад до запитань',
    err: 'Не надіслано. Перевірте інтернет і спробуйте ще раз.', eEmail: 'Перевірте адресу email.', eMany: 'Забагато повідомлень. Спробуйте трохи пізніше.',
    whereVideo: 'Коли буде готове відео?', typing: 'Пишу…', close: 'Закрити',
    faq: [
      ['Скільки чекати на відео?', 'Зазвичай 15–30 хвилин після оплати. Перед Новим роком може знадобитися кілька годин.'],
      ['А якщо ім’я незвичне?', 'Кожне ім’я ми перевіряємо вручну перед відправкою. Якщо вимова не вдалася, виправимо або напишемо вам.'],
      ['Яке фото підійде найкраще?', 'Портрет крупним планом, де обличчя займає більшу частину кадру, добре освітлене, без сонячних окулярів та інших людей. Фото здалеку в рамці вийде розмитим.'],
      ['Що ви робите з фото?', 'Використовуємо лише для вашого відео. Фото видаляємо через 30 днів після відправки, відео через 60 днів.'],
      ['Якою мовою говорить Дід Мороз?', 'Сербською. Ім’я він вимовляє в кличному відмінку, як до дитини звертаються: Milice, Luka, Đorđe.'],
    ],
  },
};
const tr = (v) => typeof v === 'string' ? cyr(v) : typeof v === 'function' ? (...a) => cyr(v(...a)) : v.map(tr);
W['sr-Cyrl'] = Object.fromEntries(Object.entries(W['sr-Latn']).map(([k, v]) => [k, tr(v)]));
W['sr-Cyrl'].faq[4][1] = W['sr-Cyrl'].faq[4][1].replace(/Милице, Лука, Ђорђе/, 'Milice, Luka, Đorđe');
// функції в JSON не переживуть — перетворюємо на шаблони з {id}
const pack = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? v('{id}') : v]));
const STR = JSON.stringify(Object.fromEntries(Object.entries(W).map(([k, v]) => [k, pack(v)])));

const CLIENT = `(function(){
if (window.__cstSupport) return; window.__cstSupport = 1;
var S = ${STR};
var api = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src).origin : location.origin;   // той самий сервер, звідки завантажено віджет
var m = /^\\/o\\/([\\w-]+)\\/([a-f0-9]{32})/.exec(location.pathname), order = m ? { id: m[1], key: m[2] } : null;
var store = { get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
function lang() { var l = document.documentElement.lang; return S[l] ? l : 'sr-Latn'; }
function t() { return S[lang()]; }
var host = document.createElement('div'); host.id = 'cst-support'; document.body.appendChild(host);
var root = host.attachShadow({ mode: 'open' });
host.hidden = true;
root.innerHTML = '<link rel="stylesheet" href="' + api + '/api/support/widget.css">' +
'<button class="fab" part="fab" aria-haspopup="dialog"><span aria-hidden="true">❄</span><span class="fl"></span></button>' +
'<section class="panel" role="dialog" aria-modal="false" hidden><div class="hd"><div><b class="tt"></b><small class="st"></small></div><button class="x">×</button></div>' +
'<div class="chat"><div class="log" aria-live="polite"></div><div class="chips"></div></div>' +
'<form class="form opf" hidden novalidate><button type="button" class="lnk bk"></button><p class="oh"></p><label><span class="ln"></span><input name="name" maxlength="60" autocomplete="name"></label><label><span class="le"></span><input name="email" type="email" maxlength="120" autocomplete="email"></label><label><span class="lt"></span><textarea name="text" rows="5" maxlength="2000" required></textarea></label><span class="er" hidden></span><button class="go os"></button></form>' +
'<form class="in"><textarea rows="1" maxlength="600"></textarea><button class="go sd" type="submit"></button></form></section>';
var $ = function (s) { return root.querySelector(s); };
$('link').onload = function () { host.hidden = false; };
var fab = $('.fab'), panel = $('.panel'), log = $('.log'), chips = $('.chips'), inForm = $('.in'), ta = $('.in textarea'), opf = $('.opf');
var history = [], tk = store.get('cst-ticket'), seen = 0, pollT = null, busy = false;
// розмова з AI — лише в межах вкладки; номер звернення пам'ятаємо, щоб клієнт побачив відповідь оператора
try { history = JSON.parse(sessionStorage.getItem('cst-chat') || '[]'); } catch (e) { history = []; }
function saveHist() { try { sessionStorage.setItem('cst-chat', JSON.stringify(history.slice(-24))); } catch (e) {} }
function bubble(cls, text, who) { var d = document.createElement('div'); d.className = 'msg ' + cls; if (who) { var w = document.createElement('span'); w.className = 'who'; w.textContent = who; d.appendChild(w); } d.appendChild(document.createTextNode(text)); log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
function labels() {
  var s = t(); $('.fl').textContent = s.open; fab.setAttribute('aria-label', s.open); $('.tt').textContent = tk ? s.ticket.replace('{id}', tk.id) : s.title; $('.st').textContent = s.sub;
  $('.x').setAttribute('aria-label', s.close); ta.placeholder = tk ? s.more : s.ph; $('.sd').textContent = s.send; $('.bk').textContent = s.back; $('.oh').textContent = s.opHint;
  $('.ln').textContent = s.name; $('.le').textContent = s.email; $('.lt').textContent = s.text; $('.os').textContent = s.opSend; panel.setAttribute('aria-label', s.title);
}
function renderChat() {
  var s = t(); log.textContent = ''; chips.textContent = '';
  if (tk && tk.messages) {
    tk.messages.forEach(function (m) { bubble(m.from === 'client' ? 'me' : 'oper', m.text, m.from === 'client' ? s.you : s.opLabel); });
    var b = document.createElement('button'); b.className = 'chip'; b.textContent = s.newQ; b.onclick = function () { tk = null; store.set('cst-ticket', null); labels(); renderChat(); }; chips.appendChild(b);
    return;
  }
  bubble('bot', order ? s.helloOrder : s.hello);
  history.forEach(function (m) { bubble(m.role === 'user' ? 'me' : 'bot', m.text); });
  var qs = order ? [[s.whereVideo, null]].concat(s.faq.slice(0, 3)) : s.faq;
  chips.classList.toggle('wrap', !history.length);   // на початку — списком, потім — одним рядком, що гортається
  var o = document.createElement('button'); o.className = 'chip op'; o.textContent = '✉ ' + s.op; o.onclick = showOp;
  if (history.length) chips.appendChild(o);
  qs.forEach(function (q) { var b = document.createElement('button'); b.className = 'chip'; b.textContent = q[0]; b.onclick = function () { if (q[1]) { local(q[0], q[1]); renderChips(); } else ask(q[0]); }; chips.appendChild(b); });
  if (!history.length) chips.appendChild(o);
}
function renderChips() { renderChat(); log.scrollTop = log.scrollHeight; }
function local(q, a) { history.push({ role: 'user', text: q }, { role: 'assistant', text: a }); saveHist(); }
function post(path, body) { return fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { j._s = r.status; return j; }); }); }
function ask(q) {
  if (busy || !q.trim()) return; busy = true; $('.sd').disabled = true;
  if (tk) { bubble('me', q, t().you); post('/api/support/ticket/' + tk.id + '/' + tk.key, { text: q }).then(function (j) { if (j.error) bubble('bot', j.error === 'too_many' ? t().eMany : t().err); else refresh(); }).catch(function () { bubble('bot', t().err); }).then(done); return; }
  history.push({ role: 'user', text: q }); saveHist(); renderChips(); var w = bubble('bot', t().typing);
  post('/api/support/chat', { history: history, lang: lang(), order: order }).then(function (j) {
    w.remove(); var a = j.reply || t().err; history.push({ role: 'assistant', text: a }); saveHist(); bubble('bot', a);
    if (j.operator) { var b = document.createElement('button'); b.className = 'chip op'; b.textContent = '✉ ' + t().op; b.onclick = showOp; var c = document.createElement('div'); c.className = 'chips'; c.style.padding = '0'; c.appendChild(b); log.appendChild(c); log.scrollTop = log.scrollHeight; }
  }).catch(function () { w.remove(); bubble('bot', t().err); }).then(done);
}
function done() { busy = false; $('.sd').disabled = false; }
function showOp() { $('.chat').hidden = true; inForm.hidden = true; opf.hidden = false; $('.er').hidden = true;
  if (order) opf.email.closest('label').hidden = true;
  var last = history.filter(function (m) { return m.role === 'user'; }).pop(); if (last && !opf.text.value) opf.text.value = last.text; opf.name.focus(); }
function hideOp() { opf.hidden = true; $('.chat').hidden = false; inForm.hidden = false; }
$('.bk').onclick = hideOp;
opf.onsubmit = function (e) {
  e.preventDefault(); var s = t(), er = $('.er'), em = opf.email.value.trim();
  if (!order && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)) { er.textContent = s.eEmail; er.hidden = false; return; }
  if (!opf.text.value.trim()) { opf.text.focus(); return; }
  $('.os').disabled = true;
  post('/api/support/ticket', { name: opf.name.value, email: em, text: opf.text.value, lang: lang(), order: order }).then(function (j) {
    if (j.error) { er.textContent = j.error === 'email' ? s.eEmail : j.error === 'too_many' ? s.eMany : s.err; er.hidden = false; return; }
    tk = { id: j.id, key: j.key }; store.set('cst-ticket', tk); opf.reset(); hideOp(); labels();
    refresh().then(function () { bubble('bot', s.sent.replace('{id}', j.id)); });
  }).catch(function () { er.textContent = s.err; er.hidden = false; }).then(function () { $('.os').disabled = false; });
};
function refresh() {
  if (!tk) return Promise.resolve();
  return fetch(api + '/api/support/ticket/' + tk.id + '/' + tk.key).then(function (r) { if (r.status === 404) { tk = null; store.set('cst-ticket', null); labels(); renderChat(); return null; } return r.json(); }).then(function (j) {
    if (!j || !j.messages) return; var ops = j.messages.filter(function (m) { return m.from === 'operator'; }).length;
    tk.messages = j.messages; store.set('cst-ticket', { id: tk.id, key: tk.key, ops: ops });
    if (!panel.hidden) renderChat();
    if (ops > ((store.get('cst-ticket-seen') || {})[tk.id] || 0) && panel.hidden) { fab.querySelector('span').textContent = '🔔'; }
  }).catch(function () {});
}
function openP() { labels(); fab.hidden = true; panel.hidden = false; renderChat(); if (tk) { refresh(); var sn = store.get('cst-ticket-seen') || {}; sn[tk.id] = tk.ops || 0; store.set('cst-ticket-seen', sn); } fab.querySelector('span').textContent = '❄';
  clearInterval(pollT); pollT = setInterval(function () { if (tk) refresh(); }, 20000); setTimeout(function () { ta.focus(); }, 50); }
function closeP() { panel.hidden = true; fab.hidden = false; clearInterval(pollT); pollT = tk ? setInterval(refresh, 120000) : null; fab.focus(); }
fab.onclick = openP; $('.x').onclick = closeP;
root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) closeP(); });
inForm.onsubmit = function (e) { e.preventDefault(); var q = ta.value; ta.value = ''; ask(q); };
ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); inForm.requestSubmit(); } });
new MutationObserver(function () { labels(); if (!panel.hidden) renderChat(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
labels(); if (tk) { refresh(); pollT = setInterval(refresh, 120000); }
})();`;

// стилі окремим файлом: сайт має суворий CSP (style-src 'self'), вбудований <style> він блокує
const CSS = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;border:0;background:#f2c46d;color:#1d1a12;font:600 15px/1 system-ui,sans-serif;box-shadow:0 10px 30px #0008;cursor:pointer}.fab:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid #fff;outline-offset:2px}.panel{position:fixed;right:18px;bottom:18px;z-index:2147483001;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 36px);display:flex;flex-direction:column;background:#10261d;color:#f7f1e6;border:1px solid #2b4a3d;border-radius:20px;box-shadow:0 24px 70px #000a;overflow:hidden}.panel[hidden],.fab[hidden],[hidden]{display:none!important}.hd{flex:none;display:flex;align-items:flex-start;gap:10px;padding:14px 14px 12px 16px;background:linear-gradient(180deg,#1b3a2e,#152e24);border-bottom:1px solid #2b4a3d}.hd b{display:block;font-size:16px;color:#f2c46d}.hd small{display:block;color:#c9bfae;font-size:12.5px;margin-top:2px}.x{margin-left:auto;background:none;border:0;color:#c9bfae;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}.chat{flex:1;min-height:0;display:flex;flex-direction:column}.log{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}.msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.bot{background:#173328;border:1px solid #2b4a3d;align-self:flex-start;border-bottom-left-radius:4px}.me{background:#f2c46d;color:#1d1a12;align-self:flex-end;border-bottom-right-radius:4px}.oper{background:#1d2f45;border:1px solid #3d5d86;align-self:flex-start;border-bottom-left-radius:4px}.who{display:block;font-size:11.5px;opacity:.75;margin-bottom:2px}.chips{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:6px;padding:2px 14px 10px;scrollbar-width:thin}.log .chips,.chips.wrap{overflow:visible;flex-wrap:wrap}.chip{flex:none;border:1px solid #2b4a3d;background:#0e211a;color:#f7f1e6;border-radius:999px;padding:7px 11px;font-size:13px;cursor:pointer;text-align:left}.chip.op{border-color:#f2c46d;color:#f2c46d}.in{flex:none;display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #2b4a3d;background:#0e211a}textarea,input{width:100%;background:#0b1a14;color:#f7f1e6;border:1px solid #2b4a3d;border-radius:12px;padding:10px;font-size:15px;resize:none}.in textarea{height:44px;max-height:120px}.go{flex:none;border:0;border-radius:12px;background:#f2c46d;color:#1d1a12;font-weight:700;padding:0 14px;cursor:pointer}.go:disabled{opacity:.5}.form{padding:14px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1}.form label{font-size:13px;color:#c9bfae}.form p{margin:0 0 4px;font-size:13.5px;color:#c9bfae}.form .go{padding:12px}.lnk{background:none;border:0;color:#c9bfae;cursor:pointer;font-size:13px;text-align:left;padding:4px 0}.er{color:#ff9b8f;font-size:13px}@media (max-width:520px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.fab{right:14px;bottom:14px}}';

module.exports = { widgetJs: () => CLIENT, widgetCss: () => CSS, W };
