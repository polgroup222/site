#!/usr/bin/env python3
"""Знаходить 4 кути світлої порожньої площини (полотно в рамці, сторінка книги) на кадрі.
python3 tools/find_canvas.py frame.png [x0 y0 x1 y1 область пошуку] -> JSON [[x,y]x4] (TL,TR,BR,BL)"""
import sys, json, numpy as np, cv2
img = cv2.imread(sys.argv[1]); H, W = img.shape[:2]
roi = [int(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [0, 0, W, H]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
mask = ((hsv[..., 2] > 150) & (hsv[..., 1] < 110)).astype(np.uint8) * 255
m2 = np.zeros_like(mask); m2[roi[1]:roi[3], roi[0]:roi[2]] = mask[roi[1]:roi[3], roi[0]:roi[2]]
m2 = cv2.morphologyEx(m2, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
cnts, _ = cv2.findContours(m2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(cnts, key=cv2.contourArea)
peri = cv2.arcLength(c, True)
for eps in np.linspace(0.01, 0.08, 15):
    ap = cv2.approxPolyDP(c, eps * peri, True)
    if len(ap) == 4: break
pts = ap.reshape(-1, 2).astype(float) if len(ap) == 4 else cv2.boxPoints(cv2.minAreaRect(c))
s = pts.sum(1); d = pts[:, 0] - pts[:, 1]
quad = [pts[np.argmin(s)], pts[np.argmax(d)], pts[np.argmax(s)], pts[np.argmin(d)]]
print(json.dumps([[round(float(x)), round(float(y))] for x, y in quad]))
