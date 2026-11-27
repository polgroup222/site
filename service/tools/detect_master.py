#!/usr/bin/env python3
"""Аналіз мастера з VN: де чорна зона під фото і коли звучить ім'я.
python3 tools/detect_master.py master.mp4 [name_track.wav] > master_detect.json
- photo: часове вікно і прямокутник, де в кадрі велика майже чорна (хромакей) пляма.
- name_voice: початок і тривалість голосу на доріжці імені (якщо дали окремий експорт доріжки).
"""
import sys, json, subprocess, re
import numpy as np, cv2

src = sys.argv[1]
name_track = sys.argv[2] if len(sys.argv) > 2 else None

def probe(f):
    j = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height,r_frame_rate:format=duration', '-of', 'json', f]))
    s = j['streams'][0]; n, d = map(int, s['r_frame_rate'].split('/'))
    return s['width'], s['height'], n / d, float(j['format']['duration'])

W, H, fps, dur = probe(src)
# скануємо 4 кадри/с у зменшеному розмірі
SW, SH = 480, 270
p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-vf', f'fps=4,scale={SW}:{SH}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
hits = []
t = 0.0
while True:
    b = p.stdout.read(SW * SH * 3)
    if len(b) < SW * SH * 3: break
    f = np.frombuffer(b, np.uint8).reshape(SH, SW, 3)
    black = (f.max(-1) < 14).astype(np.uint8)
    black = cv2.morphologyEx(black, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(black, 8)
    best = None
    for k in range(1, n):
        x, y, w, h, a = st[k]
        if a > 0.01 * SW * SH and a > 0.6 * w * h and w < SW * 0.95 and h < SH * 0.95:  # суцільна пляма, не весь кадр (не затемнення)
            if best is None or a > best[4]: best = (x, y, w, h, a)
    if best: hits.append((t, best))
    t += 0.25

photo = None
if hits:
    # найдовший безперервний відрізок
    runs, cur = [], [hits[0]]
    for h in hits[1:]:
        if h[0] - cur[-1][0] <= 0.3: cur.append(h)
        else: runs.append(cur); cur = [h]
    runs.append(cur)
    run = max(runs, key=len)
    sx, sy = W / SW, H / SH
    xs = [r[1][0] for r in run]; ys = [r[1][1] for r in run]
    x2 = [r[1][0] + r[1][2] for r in run]; y2 = [r[1][1] + r[1][3] for r in run]
    # беремо найбільший прямокутник за весь відрізок (коли Дід відійшов, чорне видно повністю)
    rect = [int(min(xs) * sx), int(min(ys) * sy), int((max(x2) - min(xs)) * sx), int((max(y2) - min(ys)) * sy)]
    photo = {'t0': round(max(run[0][0] - 0.25, 0), 2), 't1': round(min(run[-1][0] + 0.25, dur), 2), 'rect': rect,
             'other_runs': [[round(r[0][0], 2), round(r[-1][0], 2)] for r in runs if r is not run]}

name_voice = None
if name_track:
    log = subprocess.run(['ffmpeg', '-nostats', '-i', name_track, '-af', 'silencedetect=noise=-40dB:d=0.25', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    tdur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', name_track]))
    # перший звук: кінець першої тиші (якщо доріжка починається з тиші)
    on = ends[0] if starts and starts[0] < 0.05 and ends else 0.0
    off = next((s for s in starts if s > on + 0.1), tdur)
    vol = subprocess.run(['ffmpeg', '-nostats', '-ss', str(on), '-t', str(off - on), '-i', name_track, '-af', 'volumedetect', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    mean = float(re.search(r'mean_volume: (-?[\d.]+) dB', vol).group(1))
    name_voice = {'at': round(on, 3), 'orig_dur': round(off - on, 3), 'orig_mean_db': mean}

print(json.dumps({'video': {'width': W, 'height': H, 'fps': round(fps, 3), 'duration': round(dur, 3)},
                  'photo': photo, 'name_voice': name_voice}, indent=1, ensure_ascii=False))
