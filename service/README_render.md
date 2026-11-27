# Сервіс відеопривітань «шаблон + змінні»

Під кожне замовлення змінюються лише ім'я (голос + напис у книзі) і фото (у рамці). Відео нейромережею не генерується.

## Вимоги
Node ≥ 18, ffmpeg, ImageMagick, Python 3 + `opencv-python-headless<5`, `pillow`.

## Структура
- `template/template.json` — сцени, таймкоди, слоти голосу, 4 кути сторінки книги і вікна рамки.
- `src/names.js` — нормалізація імені (кирилиця→латиниця, діакритика), кличний відмінок.
- `src/voice.js`, `src/voice-cli.js` — озвучка 2 фраз на льоту з кешем. За замовчуванням ЛИШЕ кошторис, генерація тільки з `--yes`.
- `src/render.js` — `render(order)`: шари (ImageMagick, PNG без втрат) → аудіо (WAV, −16 LUFS, 2 проходи) → **одне** кодування відео H.264 CRF 18.
- `src/qc.js` — тривалість ±0.1 с, гучність −16±1 LUFS, кліпінг.
- `tools/make_snow.py` — шар снігу (робиться один раз), `tools/photo_prep.py` — фото дитини, `tools/find_canvas.py` — пошук кутів площини.

## Запуск тесту на заглушках (без витрат)
```
node src/render-cli.js --id test --name Sofija --photo foto.jpg --assets <папка з clips/, frame_scene/, fx/> --out out/test --stub-voice
```
`--assets` містить: `clips/trans.mp4, s2b, s3a, s3b, s7a, s9a, s6, s9b, music.mp3`, `frame_scene/frame_v3.png`, `fx/snow_loop.mov`, (пізніше) `audio/voice_general.wav`.
