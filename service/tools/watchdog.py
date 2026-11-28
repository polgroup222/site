#!/usr/bin/env python3
"""Агент «Сторож сервера» (погоджено 28.11.2026). Працює на самому сервері, не в контейнері: так він бачить і падіння сервісу.
Перевіряє: сайт відкривається, сервіс замовлень відповідає, рендер/черга не зависли, нічний бекап є, на диску ≥ 15% місця.
Стан пише в runtime/watchdog.json (його показує адмінка). У Telegram пише один раз при збої і один раз, коли все полагодилось.
Нічого не змінює і не видаляє. Запуск: cron кожні 10 хв (/etc/cron.d/cestitam-watchdog):
  */10 * * * * root /usr/bin/python3 /root/site/service/tools/watchdog.py >> /var/log/cestitam-watchdog.log 2>&1
"""
import os, sys, json, glob, time, shutil, ssl, urllib.request, urllib.parse
from datetime import datetime, timezone

SVC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(SVC, 'runtime', 'watchdog.json')
BACKUPS = os.environ.get('BACKUP_DIR', '/root/backups')
MIN_FREE = float(os.environ.get('MIN_FREE_PCT', 15))

def env():   # читаємо лише потрібні змінні з .env, нічого не друкуємо
    want = {'PUBLIC_URL', 'TG_BOT_TOKEN', 'TG_CHAT_ID'}; e = {}
    try:
        for line in open(os.path.join(SVC, '.env'), encoding='utf-8'):
            k, _, v = line.strip().partition('=')
            if k in want: e[k] = v.strip().strip('"').strip("'")
    except OSError: pass
    return e
E = env()
URL = (E.get('PUBLIC_URL') or 'https://80-209-231-113.sslip.io').rstrip('/')

def get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': 'cestitam-watchdog'})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        return r.status, r.read(200000)

checks = []
def add(key, ok, label, detail=''):
    checks.append({'key': key, 'ok': bool(ok), 'label': label, 'detail': detail})

# 1. сайт відкривається (через HTTPS, як у клієнта)
try:
    st, body = get(URL + '/')
    add('site', st == 200 and b'<html' in body.lower(), 'Сайт відкривається', f'HTTP {st}')
except Exception as e:
    add('site', False, 'Сайт відкривається', str(e)[:200])

# 2. сервіс замовлень живий, рендер і черга не зависли
try:
    st, body = get(URL + '/health'); h = json.loads(body)
    add('app', st == 200 and h.get('ok'), 'Сервіс замовлень відповідає', f'HTTP {st}')
    rm, wm = h.get('renderMin', 0), h.get('waitMin', 0)
    add('render', rm <= 25, 'Рендер не завис', f'поточний рендер триває {rm} хв' if rm else '')
    add('queue', wm <= 90, 'Черга рухається', f'найдовше чекає {wm} хв, у черзі {h.get("queued", 0)}' if wm else '')
except Exception as e:
    add('app', False, 'Сервіс замовлень відповідає', str(e)[:200])

# 3. нічний бекап (cron о 03:30) не старший за 26 год
files = sorted(glob.glob(os.path.join(BACKUPS, 'cestitam-*.tar.gz')), key=os.path.getmtime)
if not files:
    add('backup', False, 'Бекап зроблено', f'у {BACKUPS} немає жодного бекапу')
else:
    age = (time.time() - os.path.getmtime(files[-1])) / 3600
    add('backup', age <= 26 and os.path.getsize(files[-1]) > 0, 'Бекап зроблено', f'останній {age:.0f} год тому ({os.path.basename(files[-1])})')

# 4. місце на диску
du = shutil.disk_usage('/')
free = du.free / du.total * 100
add('disk', free >= MIN_FREE, f'На диску ≥ {MIN_FREE:.0f}% вільного', f'вільно {free:.0f}% ({du.free / 1e9:.0f} ГБ)')

# стан і повідомлення лише при зміні (збій / полагоджено)
try: prev = json.load(open(STATE, encoding='utf-8'))
except Exception: prev = {}
was_bad = set(prev.get('bad', []))
now_bad = {c['key'] for c in checks if not c['ok']}
new_bad = now_bad - was_bad
fixed = {k for k in was_bad - now_bad if k in {c['key'] for c in checks}}   # якщо перевірку не вдалося провести, не кажемо «полагоджено»
now_bad |= (was_bad - now_bad - fixed)
by = {c['key']: c for c in checks}

def tg(text):
    if not E.get('TG_BOT_TOKEN') or not E.get('TG_CHAT_ID'): return True   # Telegram не налаштовано: видно лише в адмінці
    data = urllib.parse.urlencode({'chat_id': E['TG_CHAT_ID'], 'text': text, 'disable_web_page_preview': 'true'}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{E['TG_BOT_TOKEN']}/sendMessage", data=data, timeout=20); return True
    except Exception as e:
        print('tg error', str(e)[:100]); return False

msgs = []
if new_bad: msgs.append('🚨 Čestitam: проблема на сервері\n' + '\n'.join(f"• {by[k]['label']}: ✗ {by[k]['detail']}" for k in sorted(new_bad)))
if fixed: msgs.append('✅ Čestitam: полагоджено\n' + '\n'.join(f"• {by[k]['label']}" for k in sorted(fixed)))
sent = all(tg(m + f'\n{URL}/admin') for m in msgs) if msgs else True

ts = datetime.now(timezone.utc).isoformat(timespec='seconds')
state = {'ts': ts, 'checks': checks, 'bad': sorted(now_bad if sent else was_bad)}   # якщо Telegram не дійшов — повторимо наступного разу
os.makedirs(os.path.dirname(STATE), exist_ok=True)
with open(STATE + '.tmp', 'w', encoding='utf-8') as f: json.dump(state, f, ensure_ascii=False, indent=1)
os.replace(STATE + '.tmp', STATE)
print(ts, 'OK' if not now_bad else 'BAD ' + ','.join(sorted(now_bad)), '| tg:', 'sent' if msgs and sent else ('-' if not msgs else 'fail'))
