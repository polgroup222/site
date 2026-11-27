#!/usr/bin/env python3
"""Фото дитини в бежеве полотно портрета на мастері з VN (без хромакею, по кольору полотна).
python3 tools/portrait_overlay.py master.mp4 cfg.json photo_ready.png out_overlay.mov
cfg: {"t0","t1","t_ref","rect":[x0,y0,x1,y1],"zoom_from":57.33,"zoom_center":[960,540]}
Вихід: RGBA-відео (FFV1, без втрат) розміром кадру-обрізки; позиція і час у out_overlay.json.
- Дід, борода, стрічка лишаються попереду (маска за відмінністю від чистого полотна + хроматика).
- Фото затіняється так само, як полотно (тінь Діда, затемнення переходу).
- Наприкінці VN робить наїзд-перехід: масштаб міряємо по полотну кадр за кадром і екстраполюємо.
"""
import sys, json, subprocess, numpy as np, cv2
from scipy import ndimage as nd

src, cfgp, photop, outp = sys.argv[1:5]
C = json.load(open(cfgp))
W, H = 1920, 1080
_n, _d = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src]).decode().strip().strip(',').split('/')
fps = int(_n) / int(_d)
t0, t1 = C['t0'], C['t1']
x0, y0, x1, y1 = C['rect']
zc = np.array(C.get('zoom_center', [960, 540]), np.float32)
zf = C.get('zoom_from', 1e9)

def read(ss, dur):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(ss), '-t', str(dur), '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)

clean = np.median(np.stack([f for i, f in enumerate(read(C['t_ref'], 0.5)) if i % 5 == 0]).astype(np.float32), 0)
# статична маска полотна (прямокутник мінус червона стрічка)
static = np.zeros((H, W), bool); static[y0:y1 + 1, x0:x1 + 1] = True
ribbon = (clean[..., 1] / (clean[..., 0] + 1) < 0.5)
static &= ~(cv2.dilate(ribbon.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)

# фото: заповнює прямокутник (cover), трохи тепліше під світло каміна
ph = cv2.cvtColor(cv2.imread(photop), cv2.COLOR_BGR2RGB).astype(np.float32)
rw, rh = x1 - x0 + 1, y1 - y0 + 1
s = max(rw / ph.shape[1], rh / ph.shape[0])
phr = cv2.resize(ph, (int(np.ceil(ph.shape[1] * s)), int(np.ceil(ph.shape[0] * s))), interpolation=cv2.INTER_LANCZOS4)
ox, oy = (phr.shape[1] - rw) // 2, int((phr.shape[0] - rh) * 0.35)
phr = phr[oy:oy + rh, ox:ox + rw]
phr = phr * np.array(C.get('tint', [1.0, 0.96, 0.88]), np.float32)
photo_full = np.zeros((H, W, 3), np.float32); photo_full[y0:y1 + 1, x0:x1 + 1] = phr
# освітлення полотна в чистому кадрі -> фото повторює градієнт світла
canvas_l = cv2.GaussianBlur(clean.mean(-1), (0, 0), 25)
ref_l = np.median(clean.mean(-1)[static])

def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def ratios(x):
    x = cv2.GaussianBlur(x.astype(np.float32), (5, 5), 0); r = x[..., 0] + 1
    return x[..., 1] / r, x[..., 2] / r, x.mean(-1)
def warp(img, k, interp=cv2.INTER_LINEAR):
    s_, tx, ty = k
    if abs(s_ - 1) < 1e-4 and abs(tx) < 0.05 and abs(ty) < 0.05: return img
    M = np.array([[s_, 0, tx], [0, s_, ty]], np.float32)
    return cv2.warpAffine(img, M, (W, H), flags=interp, borderMode=cv2.BORDER_CONSTANT)

def matte(f, cl, st):
    rg, rb, l = ratios(f); crg, crb, cll = ratios(cl)
    dc = np.maximum(np.abs(rg - crg) / 0.07, np.abs(rb - crb) / 0.08); lr = l / (cll + 1)
    x = cv2.GaussianBlur(f.astype(np.float32), (3, 3), 0); r = x[..., 0] + 1
    strong = (((x[..., 1] / r) < 0.4) & (x[..., 0] > 40)) | (((x[..., 1] / r) > 0.86) & (x.mean(-1) > 0.75 * cll) & (dc > 1))
    strong = cv2.morphologyEx(strong.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    zone = cv2.GaussianBlur(cv2.dilate(strong, np.ones((31, 31), np.uint8)).astype(np.float32), (15, 15), 0)
    tol = 1.0 - 0.6 * zone
    tr = (1 - ss(dc / tol, 0.8, 1.1)) * ss(lr, 0.55, 0.7) * (1 - ss(lr, 1.12, 1.2)) * (1 - strong) * st
    hc = (tr > 0.5).astype(np.uint8)
    n, lab, stt, _ = cv2.connectedComponentsWithStats(hc, 8)
    for k in range(1, n):
        m = lab == k
        if stt[k, 4] < 300 or (stt[k, 4] < 2500 and zone[m].mean() > 0.6): tr[m] = 0
    tr = tr * cv2.dilate((tr > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
    opq = ((tr <= 0.5) & (st > 0.5)).astype(np.uint8)
    n, lab, stt, _ = cv2.connectedComponentsWithStats(opq, 8)
    for k in range(1, n):
        if stt[k, 4] < 150: tr[lab == k] = 1
    return cv2.GaussianBlur(tr.astype(np.float32), (3, 3), 0) * st

# масштаб наїзду по кадрах: ширина бежевої плями, поки вона цілісна
def measure_scale(f):
    a = cv2.GaussianBlur(f.astype(np.float32), (5, 5), 0); r = a[..., 0] + 1
    L = a.mean(-1); Lr = L / (np.percentile(L, 97) + 1)
    m = (np.abs(a[..., 1] / r - 0.87) < 0.08) & (np.abs(a[..., 2] / r - 0.61) < 0.1) & (Lr > 0.45)
    lab, n = nd.label(m)
    if not n: return None
    sz = nd.sum(m, lab, range(1, n + 1)); k = int(np.argmax(sz)) + 1
    ys, xs = np.where(lab == k); bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    if bw < 0.8 * rw: return None
    top_cut = ys.min() <= 1
    if not top_cut and nd.binary_fill_holes(lab == k).sum() < 0.75 * bw * bh: return None
    sc = bw / rw
    return (sc, float(xs.min()) - x0 * sc, float(ys.max()) - y1 * sc)

N = int(round((t1 - t0) * fps)); ts = t0 + np.arange(N) / fps
scales = [(1.0, 0.0, 0.0)] * N
i_zf = int(np.searchsorted(ts, zf))
meas = [(i_zf + j, measure_scale(f)) for j, f in enumerate(read(t0 + i_zf / fps, max(t1 - t0 - i_zf / fps, 0)))] if i_zf < N else []
good = [(i, k) for i, k in meas if k is not None]
# беремо лише монотонну частину (до того, як перехід розмиває полотно)
mono, last, li = [], 1.0, i_zf
for i, k in good:
    if k[0] >= last - 0.01 and k[0] < last * (1 + 0.08 * max(1, i - li)): mono.append((i, k)); last = k[0]; li = i
mono_d = dict(mono)
lastk = (1.0, 0.0, 0.0)
for i in range(i_zf, N):
    if i in mono_d: lastk = mono_d[i]
    scales[i] = lastk
# згладжування медіаною по 5 кадрах
arr = np.array(scales)
for j in range(i_zf, N):
    a_, b_ = max(i_zf, j - 2), min(N, j + 3); arr[j] = np.median(arr[a_:b_], 0)
scales = [tuple(map(float, r)) for r in arr]
# обрізка: межі з урахуванням максимального наїзду
xs_ = [x0 * k[0] + k[1] for k in scales] + [x1 * k[0] + k[1] for k in scales]
ys_ = [y0 * k[0] + k[2] for k in scales] + [y1 * k[0] + k[2] for k in scales]
kmax = max(k[0] for k in scales)
bx0, by0 = int(max(0, min(xs_) - 4)) & ~1, int(max(0, min(ys_) - 4)) & ~1
bx1, by1 = int(min(W, max(xs_) + 4)), int(min(H, max(ys_) + 4))
cw, chh = (bx1 - bx0) & ~1, (by1 - by0) & ~1

enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{cw}x{chh}', '-r', str(fps), '-i', '-',
                        '-c:v', 'ffv1', '-pix_fmt', 'bgra', outp], stdin=subprocess.PIPE)
stf = static.astype(np.float32)
for i, f in enumerate(read(t0, t1 - t0)):
    if i >= N: break
    k = scales[i]
    Y = slice(by0, by0 + chh); X = slice(bx0, bx0 + cw)
    cl, st, pf, cvl = warp(clean, k)[Y, X], warp(stf, k)[Y, X], warp(photo_full, k, cv2.INTER_LANCZOS4)[Y, X], warp(canvas_l, k)[Y, X]
    f = f[Y, X]   # рахуємо лише в області полотна: у кілька разів швидше
    if ts[i] >= zf:   # перехід VN: Діда вже нема, беремо всю площу полотна, світло з медіани полотна
        a = cv2.erode(st, np.ones((3, 3), np.uint8)) if k[0] > 1.001 else matte(f, cl, st)
    else:
        a = matte(f, cl, st)
    # затінення: світло в цьому кадрі відносно чистого полотна (тінь, затемнення), плюс природний градієнт полотна
    if ts[i] >= zf and k[0] > 1.001:
        msk = st > 0.5
        shade = float(np.clip(np.median(f.astype(np.float32).mean(-1)[msk]) / (np.median(cl.mean(-1)[msk]) + 1), 0, 1.1)) if msk.any() else 1.0
    else:
        shade = np.clip(cv2.GaussianBlur(f.astype(np.float32).mean(-1), (0, 0), 9) / (cv2.GaussianBlur(cl.mean(-1), (0, 0), 9) + 1), 0, 1.1)
    grad = np.clip(cvl / ref_l, 0.75, 1.15)
    rgb = np.clip(pf * (shade * grad)[..., None], 0, 255)
    out = np.ascontiguousarray(np.dstack([rgb, a * 255]).astype(np.uint8))
    enc.stdin.write(out.tobytes())
enc.stdin.close(); enc.wait()
json.dump({'x': bx0, 'y': by0, 'w': cw, 'h': chh, 't0': t0, 'frames': N, 'fps': fps,
           'zoom': [[round(float(ts[i]), 3)] + [round(v, 3) for v in scales[i]] for i in range(N) if scales[i][0] != 1][:80]},
          open(outp + '.json', 'w'), indent=1)
print(json.dumps({'ok': True, 'frames': N, 'crop': [bx0, by0, cw, chh], 'max_zoom': round(float(kmax), 3), 'zoom_measured': len(mono), 'tail_frames': N - i_zf}))
