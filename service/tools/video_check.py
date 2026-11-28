#!/usr/bin/env python3
"""Агент «Перевірка готового відео»: дивиться ролик після рендеру, порівнюючи його з мастером. Нічого не змінює.
python3 tools/video_check.py master.json master.mp4 video.mp4 out_dir [voice_dur_s]
-> JSON {ok, checks:[{key, ok, label, detail}], frames:{book, portrait}, seconds}
Кадри для швидкого погляду людини: out_dir/qc_book.jpg, out_dir/qc_portrait.jpg.
Аналіз мастера (чорні кадри, тиша, гучність) кешується поруч з мастером: master_qc_cache.json.
"""
import sys, os, json, re, subprocess, time
import numpy as np, cv2

mjson, mvideo, video, outdir = sys.argv[1:5]
vdur = float(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else 0.0
t_start = time.time()
M = json.load(open(mjson))
checks = []
def add(key, ok, label, detail=''):
    checks.append({'key': key, 'ok': bool(ok), 'label': label, 'detail': detail})

def run(args):
    return subprocess.run(args, capture_output=True, text=True, errors='replace')

def probe(f):
    j = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', f]).stdout or '{}')
    return float(j.get('format', {}).get('duration', 0) or 0), [s.get('codec_type') for s in j.get('streams', [])], j.get('streams', [])

def scan(f):
    """один прохід декодування: помилки, чорні кадри, тиша, гучність (EBU R128)"""
    r = run(['ffmpeg', '-nostats', '-hide_banner', '-i', f, '-vf', 'scale=480:-2,blackdetect=d=0.4:pix_th=0.08',
             '-af', 'silencedetect=n=-50dB:d=1.5,ebur128=peak=true', '-f', 'null', '-'])
    log = r.stderr
    black = [(float(a), float(b)) for a, b in re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', log)]
    ss = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', log)]
    se = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    silence = [(a, se[i] if i < len(se) else 1e9) for i, a in enumerate(ss)]
    summ = log[log.rfind('Summary:'):]
    I = re.search(r'I:\s+(-?[\d.]+) LUFS', summ); TP = re.search(r'Peak:\s+(-?[\d.]+) dBFS', summ)
    errs = [l for l in log.splitlines() if re.search(r'error|corrupt|invalid|missing', l, re.I) and 'Input #' not in l][:5]
    return {'black': black, 'silence': silence, 'lufs': float(I.group(1)) if I else None, 'peak': float(TP.group(1)) if TP else None,
            'errors': errs, 'rc': r.returncode}

def master_scan():
    st = os.stat(mvideo); key = f'{st.st_size}:{int(st.st_mtime)}'
    cache = os.path.join(os.path.dirname(os.path.abspath(mvideo)), 'master_qc_cache.json')
    try:
        c = json.load(open(cache))
        if c.get('key') == key: return c['scan']
    except Exception: pass
    s = scan(mvideo)
    try: json.dump({'key': key, 'scan': s}, open(cache, 'w'))
    except Exception: pass
    return s

def mean_db(f, t0, dur):
    r = run(['ffmpeg', '-nostats', '-ss', str(t0), '-t', str(dur), '-i', f, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    m = re.search(r'mean_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else -91.0

def frame(f, t):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
                        '-vf', 'scale=1920:1080', '-'], capture_output=True)
    b = r.stdout
    return np.frombuffer(b[:1920 * 1080 * 3], np.uint8).reshape(1080, 1920, 3) if len(b) >= 1920 * 1080 * 3 else None

def changed(a, b):
    d = cv2.absdiff(a, b).max(axis=2)
    return float((d > 25).mean())

def overlaps(seg, segs, tol=0.3):
    return any(seg[0] < b + tol and seg[1] > a - tol for a, b in segs)

def save_jpg(name, img):
    p = os.path.join(outdir, name)
    cv2.imwrite(p, img, [cv2.IMWRITE_JPEG_QUALITY, 85]); return name

os.makedirs(outdir, exist_ok=True)
frames = {}

# 1. файл цілий: є відео і звук, тривалість як у мастера, без помилок декодування
mdur, _, _ = probe(mvideo)
dur, types, streams = probe(video)
add('streams', 'video' in types and 'audio' in types, 'Є картинка і звук', ', '.join(t for t in types if t))
add('duration', abs(dur - mdur) <= 0.15, 'Тривалість як у мастера', f'{dur:.2f} с (мастер {mdur:.2f} с)')
S, MS = scan(video), master_scan()
add('decode', S['rc'] == 0 and not S['errors'], 'Файл читається без помилок', '; '.join(S['errors'])[:300])

# 2. обриви: чорні кадри або тиша, яких нема в мастері
nb = [s for s in S['black'] if not overlaps(s, MS['black'])]
add('black', not nb, 'Немає зайвих чорних кадрів', ', '.join(f'{a:.1f}–{b:.1f} с' for a, b in nb))
ns = [s for s in S['silence'] if not overlaps(s, MS['silence'])]
add('silence', not ns, 'Немає зайвої тиші', ', '.join(f'{a:.1f}–{min(b, dur):.1f} с' for a, b in ns))

# 3. звук: гучність як у мастера, без хрипу (перевантаження)
if S['lufs'] is not None and MS['lufs'] is not None:
    add('loudness', abs(S['lufs'] - MS['lufs']) <= 1.5, 'Гучність як у мастера', f"{S['lufs']:.1f} LUFS (мастер {MS['lufs']:.1f})")
else:
    add('loudness', False, 'Гучність як у мастера', 'не вдалося виміряти')
add('clipping', S['peak'] is not None and S['peak'] < -0.3, 'Звук без хрипу (немає перевантаження)', f"пік {S['peak']} dBFS")

# 4. ім'я звучить: на місці імені звук помітно гучніший, ніж у мастері (там пауза в музиці)
NV = M.get('name_voice')
if NV:
    if vdur <= 0:
        add('voice', False, "Ім'я звучить", 'голос імені не додано')
    else:
        a, b = mean_db(video, NV['at'], vdur), mean_db(mvideo, NV['at'], vdur)
        add('voice', a > -32 and a - b >= 3, "Ім'я звучить", f'{a:.1f} dB (без імені {b:.1f} dB), {NV["at"]:.1f}–{NV["at"] + vdur:.1f} с')

# 5. ім'я в книзі: сторінка змінилась проти мастера там, де пишеться ім'я
B = M.get('book')
if B:
    t = min(B['t1'] - 0.3, B.get('write_at', B['t0']) + B.get('write_dur', 1) + 0.6)
    fo, fm = frame(video, t), frame(mvideo, t)
    if fo is None or fm is None:
        add('book', False, "Ім'я видно в книзі", 'кадр не прочитався')
    else:
        q = np.array(B['page_quad'], np.int32)
        mask = np.zeros(fo.shape[:2], np.uint8); cv2.fillPoly(mask, [q], 1)
        d = cv2.absdiff(fo, fm).max(axis=2); frac = float(((d > 25) & (mask > 0)).sum() / max(mask.sum(), 1))
        add('book', frac > 0.004, "Ім'я видно в книзі", f'змінено {frac * 100:.1f}% сторінки, {t:.1f} с')
        x, y, w, h = cv2.boundingRect(q); pad = 60
        frames['book'] = save_jpg('qc_book.jpg', fo[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad])

# 6. фото в рамці: полотно змінилось і на ньому знайдено обличчя
P = M.get('photo')
if P:
    t = P.get('t_ref', (P['t0'] + P['t1']) / 2)
    if P.get('mode') == 'canvas': x0, y0, x1, y1 = P['rect']
    else: x0, y0, w, h = P['rect']; x1, y1 = x0 + w - 1, y0 + h - 1
    fo, fm = frame(video, t), frame(mvideo, t)
    if fo is None or fm is None:
        add('photo', False, 'Фото стоїть у рамці', 'кадр не прочитався')
    else:
        co, cm = fo[y0:y1 + 1, x0:x1 + 1], fm[y0:y1 + 1, x0:x1 + 1]
        frac = changed(co, cm)
        hc = getattr(getattr(cv2, 'data', None), 'haarcascades', None) or next((d for d in ('/usr/share/opencv4/haarcascades/', '/usr/share/opencv/haarcascades/') if os.path.isdir(d)), '')
        casc = cv2.CascadeClassifier(hc + 'haarcascade_frontalface_default.xml')
        faces = casc.detectMultiScale(cv2.cvtColor(co, cv2.COLOR_BGR2GRAY), scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
        add('photo', frac > 0.2, 'Фото стоїть у рамці', f'змінено {frac * 100:.0f}% полотна, {t:.1f} с')
        add('photo_face', len(faces) > 0, 'На портреті видно обличчя', f'облич: {len(faces)}')
        pad = 80
        frames['portrait'] = save_jpg('qc_portrait.jpg', fo[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad])

print(json.dumps({'ok': all(c['ok'] for c in checks), 'checks': checks, 'frames': frames, 'seconds': round(time.time() - t_start, 1)}, ensure_ascii=False))
