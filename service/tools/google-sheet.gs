// Google-таблиця оплачених замовлень Čestitam (Apps Script). Сервер надсилає сюди лише оплачені замовлення.
// Як підключити (один раз, ~3 хв):
// 1. Створіть Google-таблицю → Розширення → Apps Script. Видаліть усе в редакторі і вставте цей файл.
// 2. Рядок SECRET нижче: впишіть будь-який довгий пароль (той самий піде в .env як SHEET_SECRET).
// 3. Розгорнути → Нове розгортання → тип «Веб-застосунок»; Виконувати як: «Я»; Доступ: «Будь-хто». Розгорнути, дозволити доступ.
// 4. Скопіюйте URL веб-застосунку (…/exec) і впишіть у /root/site/service/.env:  SHEET_WEBHOOK=…/exec  і  SHEET_SECRET=…
// Рядок замовлення оновлюється за номером (статус, дата відправки, нотатка); нових рядків-дублів не буде. Нічого не видаляється.
const SECRET = 'ВПИШІТЬ_СВІЙ_ПАРОЛЬ';
const HEAD = ['Номер', 'Створено', 'Оплачено', "Ім'я дитини", 'Email', 'Мова', 'Сума', 'Оплата', 'Статус', 'Надіслано', 'Нотатка', 'Оновлено'];
const KEYS = ['no', 'createdAt', 'paidAt', 'childName', 'email', 'lang', 'amount', 'payMethod', 'status', 'sentAt', 'note'];

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (body.secret !== SECRET) return out({ ok: false, error: 'secret' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sh.getLastRow() === 0) { sh.appendRow(HEAD); sh.setFrozenRows(1); sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold'); }
    const n = Math.max(0, sh.getLastRow() - 1);
    const nos = n ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : [];
    const fmt = (k, v) => (/At$/.test(k) && v) ? Utilities.formatDate(new Date(v), 'Europe/Kiev', 'yyyy-MM-dd HH:mm') : v;
    for (const r of body.rows || []) {
      const row = KEYS.map(k => fmt(k, r[k] ?? '')).concat([Utilities.formatDate(new Date(), 'Europe/Kiev', 'yyyy-MM-dd HH:mm')]);
      const i = nos.indexOf(String(r.no));
      if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
      else { sh.appendRow(row); nos.push(String(r.no)); }
    }
    return out({ ok: true, rows: (body.rows || []).length });
  } finally { lock.releaseLock(); }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
