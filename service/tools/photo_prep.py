#!/usr/bin/env python3
"""Підготовка фото дитини: EXIF-поворот, HEIC, пошук обличчя, обрізка 3:4 з центром на обличчі, легка корекція яскравості.
python3 tools/photo_prep.py in.jpg out.png  -> друкує JSON {ok, face, needs_review, reasons, size}"""
import sys, json, subprocess, os, tempfile
import numpy as np, cv2
from PIL import Image, ImageOps

src, dst = sys.argv[1], sys.argv[2]
OUT_W, OUT_H = 1500, 2000          # 3:4, достатньо і для відео, і для листівки
MIN_SIDE = 600
reasons = []
path = src
if src.lower().endswith(('.heic', '.heif')):
    tmp = tempfile.mktemp(suffix='.png'); subprocess.run(['convert', src, tmp], check=True); path = tmp
img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
w, h = img.size
if min(w, h) < MIN_SIDE: reasons.append('photo_too_small')
arr = np.array(img); gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
casc = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
scale = 1000 / max(w, h) if max(w, h) > 1000 else 1.0
small = cv2.resize(gray, (int(w * scale), int(h * scale))) if scale != 1 else gray
faces = casc.detectMultiScale(small, scaleFactor=1.1, minNeighbors=6, minSize=(40, 40))
face = None
if len(faces):
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3]); face = [int(v / scale) for v in (fx, fy, fw, fh)]
else:
    reasons.append('face_not_found')
# кадр 3:4: обличчя ~ 38% ширини, очі трохи вище центру
if face:
    fx, fy, fw, fh = face; cw = min(w, fw / 0.30); ch = cw * 4 / 3
    if ch > h: ch = h; cw = ch * 3 / 4
    cx, cy = fx + fw / 2, fy + fh * 0.62
    x0 = min(max(cx - cw / 2, 0), w - cw); y0 = min(max(cy - ch * 0.42, 0), h - ch)
else:
    cw = min(w, h * 3 / 4); ch = cw * 4 / 3; x0 = (w - cw) / 2; y0 = max((h - ch) * 0.3, 0)
crop = img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
if crop.size[0] < 450: reasons.append('crop_low_resolution')
# м'яка автокорекція яскравості
lum = np.array(crop.convert('L')).mean()
if lum < 95 or lum > 175:
    from PIL import ImageEnhance
    crop = ImageEnhance.Brightness(crop).enhance(float(np.clip(135 / max(lum, 1), 0.75, 1.35)))
crop = ImageOps.autocontrast(crop, cutoff=0.5)
crop.resize((OUT_W, OUT_H), Image.LANCZOS).save(dst)
print(json.dumps({'ok': True, 'face': face, 'source_size': [w, h], 'crop_size': list(crop.size),
                  'needs_review': bool(reasons), 'reasons': reasons}))
