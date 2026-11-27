'use strict';
// Čestitam: jezik, živi pregled imena u knjizi, porudžbina (ime + fotografija + email -> server).
(function () {
const T = {
'sr-Latn': {
  skip: 'Pređi na porudžbinu', brand: 'Čestitam', navPeek: 'Iz filma', navHow: 'Kako radi', navFaq: 'Pitanja', langLabel: 'Jezik', cta: 'Napravi čestitku',
  edition: 'Novogodišnje izdanje',
  heroTitle: 'Deda Mraz zna ime vašeg deteta',
  heroLead: 'Novogodišnji film u kom Deda Mraz izgovara ime deteta, upisuje ga u čarobnu knjigu i kači njegovu fotografiju na zid.',
  tryLabel: 'Upišite ime i pogledajte kako izgleda u knjizi',
  peekTitle: 'Malo od onoga što dete čeka', p1: 'Kuća Deda Mraza', p2: 'Irvasi', p3: 'Radionica igračaka',
  noteBig: 'Ime, glas i fotografija samo vašeg deteta', c1: 'Ime deteta', c2: 'Njegova fotografija', c3: 'Glas Deda Mraza',
  howTitle: 'Kako radi', s1t: 'Pošaljite ime i fotografiju', s1p: 'Dovoljna je jedna jasna fotografija lica, snimljena telefonom.',
  s2t: 'Mi pravimo film', s2p: 'Glas Deda Mraza izgovara ime, a mi pregledamo svaki video pre slanja.', s3t: 'Dobijate link', s3p: 'Gledate na telefonu ili TV-u i preuzimate u Full HD kvalitetu.',
  orderArt: 'Deda Mraz se oprašta sa detetom na kraju filma.', orderTitle: 'Napravite čestitku',
  fName: 'Ime deteta', fNameHint: 'Kako ga zovete kod kuće, na latinici. Na primer: Milica, Luka, Đorđe.',
  fPhoto: 'Fotografija deteta', fPhotoBtn: 'Izaberite fotografiju', fPhotoChange: 'Promeni fotografiju',
  fPhotoHint: 'Lice izbliza, gleda u kameru, dobro osvetljeno. Bez naočara za sunce i bez drugih ljudi na slici.',
  fEmail: 'Vaš email', fEmailHint: 'Na ovu adresu šaljemo link do gotovog videa.',
  consent: 'Roditelj sam ili staratelj i slažem se sa <a href="privacy.html">pravilima privatnosti</a>.',
  send: 'Pošalji porudžbinu', sending: 'Šaljemo…', payNote: 'Posle porudžbine javljamo vam se sa uputstvom za plaćanje. Izrada počinje čim stigne uplata.',
  ok: 'Porudžbina je primljena. Status i gotov video su na vašoj stranici:', open: 'Otvori stranicu porudžbine',
  eName: 'Upišite ime deteta latinicom.', ePhoto: 'Dodajte fotografiju (JPG, PNG ili HEIC, do 30 MB).', eEmail: 'Proverite email adresu.', eConsent: 'Potvrdite saglasnost sa pravilima privatnosti.',
  eMany: 'Previše pokušaja. Pokušajte ponovo za 10 minuta.', eNet: 'Porudžbina nije poslata. Proverite internet i pokušajte ponovo.', eOff: 'Porudžbine trenutno nisu otvorene.',
  faqTitle: 'Pitanja', q1: 'Koliko se čeka na video?', a1: 'Obično 15 do 30 minuta posle uplate. U danima pred Novu godinu može potrajati do nekoliko sati.',
  q2: 'Šta ako ime deteta nije uobičajeno?', a2: 'Svako ime proveravamo ručno pre slanja. Ako izgovor nije dobar, ispravićemo ga ili ćemo vam se javiti.',
  q3: 'Koja fotografija je najbolja?', a3: 'Portret izbliza na kom lice zauzima veći deo slike. Fotografija iz daljine ispadne mutna u ramu.',
  q4: 'Šta radite sa fotografijom?', a4: 'Koristimo je samo za vaš video. Fotografiju brišemo 30 dana posle slanja, a video posle 60 dana.',
  q5: 'Na kom jeziku govori Deda Mraz?', a5: 'Na srpskom. Ime izgovara u vokativu, kako se dete i doziva: Milice, Luka, Đorđe.',
  foot: 'Mali film za veliko verovanje.', footContact: 'Kontakt', footLegal: 'Pravila', privacy: 'Privatnost',
},
uk: {
  skip: 'Перейти до замовлення', brand: 'Čestitam', navPeek: 'З фільму', navHow: 'Як це працює', navFaq: 'Запитання', langLabel: 'Мова', cta: 'Створити привітання',
  edition: 'Новорічний випуск',
  heroTitle: 'Дід Мороз знає ім’я вашої дитини',
  heroLead: 'Новорічний фільм, у якому Дід Мороз вимовляє ім’я дитини, вписує його в чарівну книгу і вішає її фото на стіну.',
  tryLabel: 'Впишіть ім’я латиницею і подивіться, як воно виглядає в книзі',
  peekTitle: 'Трохи з того, що чекає на дитину', p1: 'Будиночок Діда Мороза', p2: 'Олені', p3: 'Майстерня іграшок',
  noteBig: 'Ім’я, голос і фото тільки вашої дитини', c1: 'Ім’я дитини', c2: 'Її фото', c3: 'Голос Діда Мороза',
  howTitle: 'Як це працює', s1t: 'Надішліть ім’я і фото', s1p: 'Достатньо одного чіткого фото обличчя, знятого на телефон.',
  s2t: 'Ми створюємо фільм', s2p: 'Голос Діда Мороза вимовляє ім’я, а ми переглядаємо кожне відео перед відправкою.', s3t: 'Ви отримуєте посилання', s3p: 'Дивіться на телефоні чи телевізорі й завантажуйте у Full HD.',
  orderArt: 'Дід Мороз прощається з дитиною наприкінці фільму.', orderTitle: 'Створіть привітання',
  fName: 'Ім’я дитини', fNameHint: 'Латиницею, як кличете вдома. Дід Мороз говорить сербською: Milica, Luka, Đorđe.',
  fPhoto: 'Фото дитини', fPhotoBtn: 'Обрати фото', fPhotoChange: 'Змінити фото',
  fPhotoHint: 'Обличчя крупним планом, дивиться в камеру, гарне світло. Без сонцезахисних окулярів та інших людей у кадрі.',
  fEmail: 'Ваш email', fEmailHint: 'На цю адресу надішлемо посилання на готове відео.',
  consent: 'Я батько, мати чи опікун і погоджуюся з <a href="privacy.html">правилами конфіденційності</a>.',
  send: 'Надіслати замовлення', sending: 'Надсилаємо…', payNote: 'Після замовлення ми надішлемо інструкцію з оплати. Створення починається одразу після оплати.',
  ok: 'Замовлення прийнято. Статус і готове відео будуть на вашій сторінці:', open: 'Відкрити сторінку замовлення',
  eName: 'Впишіть ім’я дитини латиницею.', ePhoto: 'Додайте фото (JPG, PNG або HEIC, до 30 МБ).', eEmail: 'Перевірте адресу email.', eConsent: 'Підтвердьте згоду з правилами конфіденційності.',
  eMany: 'Забагато спроб. Спробуйте ще раз за 10 хвилин.', eNet: 'Замовлення не надіслано. Перевірте інтернет і спробуйте ще раз.', eOff: 'Замовлення зараз не приймаються.',
  faqTitle: 'Запитання', q1: 'Скільки чекати на відео?', a1: 'Зазвичай 15–30 хвилин після оплати. Перед Новим роком може знадобитися кілька годин.',
  q2: 'А якщо ім’я незвичне?', a2: 'Кожне ім’я ми перевіряємо вручну перед відправкою. Якщо вимова не вдалася, виправимо або напишемо вам.',
  q3: 'Яке фото підійде найкраще?', a3: 'Портрет крупним планом, де обличчя займає більшу частину кадру. Фото здалеку в рамці вийде розмитим.',
  q4: 'Що ви робите з фото?', a4: 'Використовуємо лише для вашого відео. Фото видаляємо через 30 днів після відправки, відео через 60 днів.',
  q5: 'Якою мовою говорить Дід Мороз?', a5: 'Сербською. Ім’я він вимовляє в кличному відмінку, як до дитини звертаються: Milice, Luka, Đorđe.',
  foot: 'Маленький фільм для великої віри.', footContact: 'Контакти', footLegal: 'Правила', privacy: 'Конфіденційність',
},
};
function cyr(s){const p={'DŽ':'Џ','Dž':'Џ','dž':'џ','LJ':'Љ','Lj':'Љ','lj':'љ','NJ':'Њ','Nj':'Њ','nj':'њ','A':'А','B':'Б','C':'Ц','Č':'Ч','Ć':'Ћ','D':'Д','Đ':'Ђ','E':'Е','F':'Ф','G':'Г','H':'Х','I':'И','J':'Ј','K':'К','L':'Л','M':'М','N':'Н','O':'О','P':'П','R':'Р','S':'С','Š':'Ш','T':'Т','U':'У','V':'В','Z':'З','Ž':'Ж','a':'а','b':'б','c':'ц','č':'ч','ć':'ћ','d':'д','đ':'ђ','e':'е','f':'ф','g':'г','h':'х','i':'и','j':'ј','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п','r':'р','s':'с','š':'ш','t':'т','u':'у','v':'в','z':'з','ž':'ж'};
  return s.replace(/(<[^>]*>)|(\b(?:Full HD|TV|JPG|PNG|HEIC|MB|email)\b)|DŽ|Dž|dž|LJ|Lj|lj|NJ|Nj|nj|[A-Za-zČĆĐŠŽčćđšž]/g,(m,tag,keep)=>tag||keep||(p[m]||m));}
T['sr-Cyrl'] = Object.fromEntries(Object.entries(T['sr-Latn']).map(([k, v]) => [k, cyr(v)]));
// imena-primeri ostaju latinicom (tako ih upisujemo)
T['sr-Cyrl'].brand = 'Čestitam';
for (const k of ['fNameHint', 'a5']) T['sr-Cyrl'][k] = T['sr-Cyrl'][k].replace(/Милица, Лука, Ђорђе|Милице, Лука, Ђорђе/, m => k === 'a5' ? 'Milice, Luka, Đorđe' : 'Milica, Luka, Đorđe');

const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const sel = document.querySelector('#language');
let lang = store.get('zp-lang');
if (!T[lang]) lang = (navigator.language || '').toLowerCase().startsWith('uk') ? 'uk' : 'sr-Latn';
const t = () => T[lang];
function applyLang() {
  document.documentElement.lang = lang; sel.value = lang;
  document.querySelectorAll('[data-i]').forEach(el => { const v = t()[el.dataset.i]; if (v !== undefined) el.innerHTML = v; });
  const has = document.querySelector('#preview:not([hidden])');
  document.querySelector('.drop-text').textContent = has ? t().fPhotoChange : t().fPhotoBtn;
}
sel.addEventListener('change', () => { lang = sel.value; store.set('zp-lang', lang); applyLang(); });
applyLang();

// ---------- živo ime u knjizi: projekcija teksta na stranicu (iste koordinate kao u renderu) ----------
const QUAD = [[1085, 372], [1540, 466], [1255, 838], [702, 720]], UV = [0.1, 0.30, 0.9, 0.62], FW = 1920;
function solve(A, b) { const n = b.length; for (let i = 0; i < n; i++) { let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
  for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  const x = Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; } return x; }
function homo(src, dst) { const A = [], b = []; for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i];
  A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); } const h = solve(A, b); return [...h, 1]; }
const apply = (h, x, y) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
const book = document.querySelector('#book'), ink = document.querySelector('#ink'), inkText = document.querySelector('#inkText'), tryName = document.querySelector('#tryName');
function placeInk() {
  const k = book.clientWidth / FW, page = homo([[0, 0], [1, 0], [1, 1], [0, 1]], QUAD);
  const box = [[UV[0], UV[1]], [UV[2], UV[1]], [UV[2], UV[3]], [UV[0], UV[3]]].map(([u, v]) => apply(page, u, v).map(c => c * k));
  const W = 400, H = 100, h = homo([[0, 0], [W, 0], [W, H], [0, H]], box);
  ink.style.transform = `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,${h[8]})`;
  const fit = () => { inkText.style.fontSize = '72px'; const r = Math.min(1.45, (W * 0.92) / inkText.scrollWidth); inkText.style.fontSize = 72 * r + 'px'; };
  fit();
}
let wt;
function setName(v) {
  const n = v.replace(/[^A-Za-zČĆĐŠŽčćđšž' -]/g, '').trim(); inkText.textContent = n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  placeInk(); clearTimeout(wt); ink.classList.remove('write');
  wt = setTimeout(() => { void ink.offsetWidth; ink.classList.add('write'); }, 350);
}
tryName.addEventListener('input', () => { setName(tryName.value); const f = document.querySelector('#fName'); if (f && !f.dataset.touched) f.value = tryName.value; });
window.addEventListener('resize', placeInk);
document.fonts && document.fonts.load('72px "Great Vibes"').then(() => setName(tryName.value));
setName(tryName.value);
const fName = document.querySelector('#fName');
fName.value = tryName.value;
fName.addEventListener('input', () => { fName.dataset.touched = 1; });

// ---------- fotografija: pregled + smanjenje u pregledaču ----------
const fPhoto = document.querySelector('#fPhoto'), preview = document.querySelector('#preview');
fPhoto.addEventListener('change', () => {
  const f = fPhoto.files[0]; if (!f) return;
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(f); preview.hidden = false; preview.onerror = () => { preview.hidden = true; };
  document.querySelector('.drop-text').textContent = t().fPhotoChange;
});
function shrink(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.9)); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('photo')); };
    img.src = url;
  });
}

// ---------- slanje ----------
const api = (document.querySelector('meta[name="order-api"]')?.content || '').replace(/\/$/, '');
const form = document.querySelector('#orderForm'), out = document.querySelector('#result');
const say = (msg, err, field) => {
  out.className = 'result' + (err ? ' err' : ''); out.textContent = msg; out.hidden = false;
  form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
};
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form), name = String(f.get('name') || '').trim(), email = String(f.get('email') || '').trim(), file = fPhoto.files[0];
  if (!/^[A-Za-zČĆĐŠŽčćđšž' -]{2,30}$/.test(name)) return say(t().eName, 1, fName);
  if (!file || file.size > 30e6) return say(t().ePhoto, 1, fPhoto);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(t().eEmail, 1, form.email);
  if (!form.consent.checked) return say(t().eConsent, 1, form.consent);
  if (!api) return say(t().eOff, 1);
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = t().sending;
  try {
    const photo = await shrink(file).catch(() => file.size <= 12e6 ? new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(Object.assign(new Error(), { code: 'photo' })); fr.readAsDataURL(file); })
      : Promise.reject(Object.assign(new Error(), { code: 'photo' })));
    const r = await fetch(`${api}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, lang, photo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const m = { name: [t().eName, fName], photo: [t().ePhoto, fPhoto], email: [t().eEmail, form.email], too_many: [t().eMany] }[j.error] || [t().eNet]; return say(m[0], 1, m[1]); }
    out.className = 'result'; out.textContent = t().ok + ' '; const a = document.createElement('a'); a.href = j.url; a.textContent = t().open; a.rel = 'noopener'; out.append(a); out.hidden = false;
    form.reset(); preview.hidden = true; document.querySelector('.drop-text').textContent = t().fPhotoBtn;
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) { say(err.code === 'photo' ? t().ePhoto : t().eNet, 1, err.code === 'photo' ? fPhoto : null); }
  finally { btn.disabled = false; btn.textContent = t().send; }
});
// ---------- izgled: traka postaje puna posle Deda Mraza, blokovi se pojavljuju pri skrolu ----------
const bar = document.querySelector('.bar.over'), stage = document.querySelector('.stage');
if (bar && stage) { const onScroll = () => bar.classList.toggle('solid', window.scrollY > stage.offsetHeight - 80); window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
if ('IntersectionObserver' in window) {
  document.documentElement.classList.add('js');
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}
})();
