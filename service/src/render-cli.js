#!/usr/bin/env node
'use strict';
// node src/render-cli.js --name Stefan --photo foto.jpg --assets <папка з кліпами> --out out/test1 [--stub-voice] [--allow-spend]
const { render } = require('./render');
const a = process.argv.slice(2); const g = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
render({ id: g('--id') || 'test', name: g('--name'), photo: g('--photo'), assetsDir: g('--assets'), outDir: g('--out'),
  stubVoice: a.includes('--stub-voice'), allowSpend: a.includes('--allow-spend') })
  .then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exit(1); });
