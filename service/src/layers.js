'use strict';
// Генерація шарів одного замовлення (ImageMagick, PNG без втрат): ім'я на сторінці книги і фото в рамці.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const im = (args) => execFileSync('convert', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
// білінійна точка всередині чотирикутника (u: TL->TR, v: TL->BL)
function quadPoint(q, u, v) { return lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v); }

/**
 * Ім'я золотим рукописом, спроєктоване на сторінку (corner-pin). Повертає:
 * { ink: PNG на всьому кадрі (RGBA), glow: PNG, bbox:{x,y,w,h}, fits, pointsize }
 */
function renderBookName(name, cfg, assetsDir, outDir) {
  const font = path.join(assetsDir, cfg.font);
  const PW = 1600, PH = 1100; // «плоска» сторінка в умовних пікселях
  const [u0, v0, u1, v1] = cfg.text_box_uv;
  const boxW = Math.round(PW * (u1 - u0)), boxH = Math.round(PH * (v1 - v0));
  // підбираємо кегль: довгі імена автоматично зменшуються
  let pointsize = 600, w = 0, h = 0;
  for (; pointsize >= 100; pointsize -= 10) {
    [w, h] = im(['-font', font, '-pointsize', String(pointsize), `label:${name}`, '-trim', '-format', '%w %h', 'info:']).trim().split(' ').map(Number);
    if (w <= boxW && h <= boxH) break;
  }
  const fits = w <= boxW && h <= boxH;
  const flat = path.join(outDir, 'name_flat.png');
  const x = Math.round(PW * u0 + (boxW - w) / 2), y = Math.round(PH * v0 + (boxH - h) / 2);
  im(['-size', `${PW}x${PH}`, 'xc:none', '-font', font, '-pointsize', String(pointsize), '-fill', 'white',
      '-gravity', 'NorthWest', '-annotate', `+${x}+${y - Math.round(pointsize * 0.18)}`, name, flat]);
  // corner-pin: прямокутник сторінки -> 4 кути на кадрі
  const q = cfg.page_quad;
  const map = [[0, 0, ...q[0]], [PW, 0, ...q[1]], [PW, PH, ...q[2]], [0, PH, ...q[3]]].map(a => a.join(',')).join(' ');
  const pinned = path.join(outDir, 'name_pinned_mask.png');
  im([flat, '-virtual-pixel', 'transparent', '-define', 'distort:viewport=1920x1080+0+0', '-distort', 'Perspective', map, '+repage', pinned]);
  const bb = im([pinned, '-alpha', 'extract', '-trim', '-format', '%w %h %X %Y', 'info:']).trim().split(' ').map(s => parseInt(s, 10));
  const pad = 24;
  const bbox = { x: Math.max(bb[2] - pad, 0), y: Math.max(bb[3] - pad, 0) };
  bbox.w = Math.min(bb[0] + 2 * pad, 1920 - bbox.x); bbox.h = Math.min(bb[1] + 2 * pad, 1080 - bbox.y);
  bbox.w -= bbox.w % 2; bbox.h -= bbox.h % 2;
  const crop = `${bbox.w}x${bbox.h}+${bbox.x}+${bbox.y}`;
  // чорнило (для multiply): колір чорнила + альфа маски, легке розмиття країв «вбирається» в папір
  const ink = path.join(outDir, 'name_ink.png');
  im([pinned, '-crop', crop, '+repage', '-alpha', 'extract', '-blur', '0x0.6', '(', '+clone', '-fill', cfg.ink_color, '-colorize', '100', ')', '+swap',
      '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', ink]);
  // сяйво (звичайне накладання поверх)
  const glow = path.join(outDir, 'name_glow.png');
  im([pinned, '-crop', crop, '+repage', '-alpha', 'extract', '-blur', '0x7', '-evaluate', 'multiply', String(cfg.glow_opacity), '(', '+clone', '-fill', cfg.glow_color, '-colorize', '100', ')', '+swap',
      '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', glow]);
  return { ink, glow, bbox, fits, pointsize };
}

/** Фото дитини в рамці на нерухомому кадрі. Повертає шлях до готового кадру (PNG, роздільність still). */
function renderPortrait(stillPath, photoPath, cfg, outDir) {
  const q = cfg.frame_quad;
  const [pw, ph] = im([photoPath, '-format', '%w %h', 'info:']).trim().split(' ').map(Number);
  const [sw, sh] = im([stillPath, '-format', '%w %h', 'info:']).trim().split(' ').map(Number);
  const toned = path.join(outDir, 'photo_toned.png');
  const args = [photoPath, '-fill', cfg.tint, '-colorize', String(cfg.tint_amount), '-modulate', '97,92'];
  if (cfg.vignette) args.push('-background', 'black', '-vignette', `0x${Math.round(pw * 0.12)}+${-Math.round(pw * 0.06)}+${-Math.round(ph * 0.06)}`);
  // внутрішня тінь від рами
  args.push('(', '-size', `${pw}x${ph}`, 'xc:black', '-fill', 'white', '-draw', `rectangle ${Math.round(pw * 0.03)},${Math.round(ph * 0.025)} ${Math.round(pw * 0.97)},${Math.round(ph * 0.975)}`,
            '-blur', `0x${Math.round(pw * 0.02)}`, ')', '-compose', 'Multiply', '-composite', toned);
  im(args);
  const map = [[0, 0, ...q[0]], [pw, 0, ...q[1]], [pw, ph, ...q[2]], [0, ph, ...q[3]]].map(a => a.join(',')).join(' ');
  const out = path.join(outDir, 'portrait_composite.png');
  im([stillPath, '(', toned, '-virtual-pixel', 'transparent', '-define', `distort:viewport=${sw}x${sh}+0+0`, '-distort', 'Perspective', map, '+repage', ')',
      '-compose', 'Over', '-composite', out]);
  return out;
}

module.exports = { renderBookName, renderPortrait, quadPoint };
