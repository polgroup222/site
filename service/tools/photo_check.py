#!/usr/bin/env python3
"""Агент «Контроль замовлень»: перевірка фото дитини одразу після замовлення (нічого не змінює, нічого не витрачає).
python3 tools/photo_check.py photo.jpg  -> JSON {ok, faces, size, brightness, sharpness, problems:[...], notes:[...]}
problems — заважають гарному результату (замовлення чекає вашого «OK»), notes — просто до відома.
"""
import sys, json, subprocess, os, tempfile
import numpy as np, cv2
from PIL import Image, ImageOps

src = sys.argv[1]
problems, notes = [], []
path = src
if src.lower().endswith(('.heic', '.heif')):
    tmp = tempfile.mktemp(suffix='.png'); subprocess.run(['convert', src, tmp], check=True); path = tmp
try:
    img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
except Exception as e:
    print(json.dumps({'ok': False, 'problems': ['photo_unreadable'], 'notes': [str(e)[:200]]})); sys.exit(0)
w, h = img.size
if min(w, h) < 600: problems.append('photo_too_small')
arr = np.array(img); gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

_hc = getattr(getattr(cv2, 'data', None), 'haarcascades', None) or next((d for d in ('/usr/share/opencv4/haarcascades/', '/usr/share/opencv/haarcascades/') if os.path.isdir(d)), '')
casc = cv2.CascadeClassifier(_hc + 'haarcascade_frontalface_default.xml')
scale = 1000 / max(w, h) if max(w, h) > 1000 else 1.0
small = cv2.resize(gray, (int(w * scale), int(h * scale))) if scale != 1 else gray
faces = casc.detectMultiScale(small, scaleFactor=1.1, minNeighbors=6, minSize=(40, 40))
faces = [[int(v / scale) for v in f] for f in faces]
if not faces:
    problems.append('face_not_found')
else:
    big = max(faces, key=lambda f: f[2] * f[3])
    # інші обличчя, помітно менші за головне, вважаємо фоном
    others = [f for f in faces if f is not big and f[2] * f[3] > 0.35 * big[2] * big[3]]
    if others: problems.append('several_faces')
    # фото обрізається так, що обличчя ≈ 30% ширини портрета: менше ~90 px — портрет буде розмитим
    if big[2] < 90: problems.append('face_too_small')
    elif big[2] < 0.07 * min(w, h): notes.append('face_small_in_photo')
    fx, fy, fw, fh = big
    face_px = gray[fy:fy + fh, fx:fx + fw]
    if face_px.size and face_px.mean() < 55: problems.append('face_too_dark')

lum = float(gray.mean())
if lum < 50: problems.append('photo_too_dark')
elif lum > 215: problems.append('photo_too_bright')
# різкість: дисперсія Лапласіана на зменшеній копії (не залежить від розміру файлу)
g8 = cv2.resize(gray, (800, int(800 * h / w))) if w > 800 else gray
sharp = float(cv2.Laplacian(g8, cv2.CV_64F).var())
if sharp < 25: problems.append('photo_blurry')
elif sharp < 60: notes.append('photo_slightly_soft')

print(json.dumps({'ok': not problems, 'faces': len(faces), 'face': max(faces, key=lambda f: f[2] * f[3]) if faces else None, 'size': [w, h], 'brightness': round(lum), 'sharpness': round(sharp),
                  'problems': problems, 'notes': notes}))
