// Справжнє замовлення: ім'я + фото + email -> сервер рендеру. Адреса сервера в <meta name="order-api">.
// Якщо адреса порожня, сайт лишається в демо-режимі (як було).
(function () {
  const api = (document.querySelector('meta[name="order-api"]')?.content || '').replace(/\/$/, '');
  if (!api) return;
  const L = {
    uk: { photo: 'Фото дитини', photoHint: 'Чітке фото обличчя, JPG або PNG', send: 'Оформити замовлення', sending: 'Надсилаємо…', ok: 'Дякуємо! Замовлення прийнято. Стежити за ним і отримати відео можна тут:', open: 'Відкрити сторінку замовлення', err: 'Не вдалося надіслати. Перевірте дані і спробуйте ще раз.', errName: 'Перевірте ім’я дитини.', errPhoto: 'Потрібне фото (JPG або PNG, до 12 МБ).', errEmail: 'Перевірте email.', errMany: 'Забагато спроб, спробуйте пізніше.', soon: 'скоро', note: 'Зараз доступне привітання від Діда Мороза для однієї дитини.' },
    'sr-Latn': { photo: 'Fotografija deteta', photoHint: 'Jasna fotografija lica, JPG ili PNG', send: 'Poruči čestitku', sending: 'Šaljemo…', ok: 'Hvala! Porudžbina je primljena. Pratite je i preuzmite video ovde:', open: 'Otvori stranicu porudžbine', err: 'Slanje nije uspelo. Proverite podatke i pokušajte ponovo.', errName: 'Proverite ime deteta.', errPhoto: 'Potrebna je fotografija (JPG ili PNG, do 12 MB).', errEmail: 'Proverite email.', errMany: 'Previše pokušaja, pokušajte kasnije.', soon: 'uskoro', note: 'Trenutno je dostupna čestitka Deda Mraza za jedno dete.' },
  };
  L['sr-Cyrl'] = Object.fromEntries(Object.entries(L['sr-Latn']).map(([k, v]) => [k, typeof cyr === 'function' ? cyr(v) : v]));
  const t = () => L[document.documentElement.lang] || L['sr-Latn'];
  const form = document.querySelector('#orderForm');
  if (!form) return;

  // поки що: один герой (Дід Мороз) і одна дитина
  form.querySelectorAll('[name=character][value=nicholas], [name=count][value="2"], [name=count][value="3"]').forEach(x => { x.disabled = true; x.closest('label')?.classList.add('is-soon'); });
  const demo = document.querySelector('.demo-label');
  const prevRender = window.renderChildren;
  window.renderChildren = function () {
    prevRender();
    const row = document.querySelector('#children .child-row');
    if (!row || row.querySelector('[name=photo]')) return;
    const lab = document.createElement('label'); lab.className = 'field';
    lab.innerHTML = `<span></span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" required><small></small>`;
    lab.querySelector('span').textContent = t().photo; lab.querySelector('small').textContent = t().photoHint;
    row.after(lab);
    form.querySelector('[name=childAge0]')?.removeAttribute('required');
    if (demo) demo.textContent = t().note;
    const btn = form.querySelector('button.submit'); if (btn) btn.textContent = t().send;
  };
  window.renderChildren();
  document.querySelectorAll('.variant-select').forEach(b => b.addEventListener('click', () => {
    const one = form.querySelector('[name=count][value="1"]'); if (one) one.checked = true; window.renderChildren();
  }));
  document.querySelector('#language')?.addEventListener('change', () => setTimeout(window.renderChildren, 0));

  // фото зменшуємо в браузері: до 2000 px, JPEG 0.9 (швидше і дешевше передавати)
  function shrink(file) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('photo')); };
      img.src = url;
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    const box = document.querySelector('#review'), btn = form.querySelector('button.submit'), f = new FormData(form);
    const show = (msg) => { box.textContent = msg; box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    const file = f.get('photo');
    if (!file || !file.size || file.size > 30e6) return show(t().errPhoto);
    btn.disabled = true; const old = btn.textContent; btn.textContent = t().sending;
    try {
      const photo = await shrink(file);
      const r = await fetch(`${api}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.get('childName0'), email: f.get('email'), lang: document.documentElement.lang, photo, wishes: f.get('wishes') || '' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return show({ name: t().errName, photo: t().errPhoto, email: t().errEmail, too_many: t().errMany }[j.error] || t().err);
      box.textContent = ''; box.append(t().ok, document.createElement('br'));
      const a = document.createElement('a'); a.href = j.url; a.textContent = t().open; a.rel = 'noopener'; box.append(a);
      box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); form.reset();
    } catch { show(t().err); }
    finally { btn.disabled = false; btn.textContent = old; }
  }, true);
})();
