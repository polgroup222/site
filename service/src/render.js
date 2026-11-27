'use strict';
// render(order): збирає одне персональне відео з готових шарів ОДНИМ кодуванням. Жодної генерації відео.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveName } = require('./names');
const { getSlotAudio } = require('./voice');
const { renderBookName, renderPortrait } = require('./layers');
const { runQc } = require('./qc');

const ROOT = path.join(__dirname, '..');
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();
const r3 = (x) => Math.round(x * 1000) / 1000;

function loadTemplate(p = path.join(ROOT, 'template', 'template.json')) {
  const t = JSON.parse(fs.readFileSync(p, 'utf8'));
  let start = 0;
  t.segments.forEach((s, i) => {
    s.len = s.dur + (s.freeze || 0);
    s.start = r3(start);
    start += s.len - (i < t.segments.length - 1 ? (s.xfade || 0) : 0);
  });
  t.total = r3(start);
  t.seg = Object.fromEntries(t.segments.map(s => [s.id, s]));
  for (const s of Object.values(t.slots)) s.global = r3(t.seg[s.segment].start + s.at);
  return t;
}

function stubSlot(outFile, seconds) { // заглушка замість голосу: тихий дзвіночок, щоб перевірити таймінг і приглушення музики
  sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*660*t)*exp(-3*mod(t\\,0.6)):s=44100:d=${seconds}`, '-ac', '1', outFile]);
  return outFile;
}
const durationOf = (f) => parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));

/**
 * order = { id, name, photo, outDir, assetsDir, allowSpend=false, stubVoice=false }
 */
async function render(order) {
  const t0 = Date.now();
  const T = loadTemplate(order.template);
  const A = order.assetsDir;
  const out = order.outDir; fs.mkdirSync(out, { recursive: true });
  const review = [];
  // 1. ім'я
  const nm = resolveName(order.name);
  if (!nm.ok) throw new Error(`Некоректне ім'я: ${order.name}`);
  if (nm.needsReview) review.push(...nm.reviewReasons);
  // 2. голос (кеш або ElevenLabs, або заглушка)
  let slots;
  if (order.stubVoice) {
    slots = { slot1: stubSlot(path.join(out, 'slot1_stub.wav'), 2.6), slot2: stubSlot(path.join(out, 'slot2_stub.wav'), 1.8) };
    review.push('voice_stub');
  } else {
    slots = (await getSlotAudio(nm.tts_vocative, { allowSpend: !!order.allowSpend })).files;
  }
  for (const [k, f] of Object.entries(slots)) if (durationOf(f) > T.slots[k].max_dur) review.push(`${k}_too_long`);
  // 3. фото
  const photoReady = path.join(out, 'photo_ready.png');
  const ph = JSON.parse(sh('python3', [path.join(ROOT, 'tools', 'photo_prep.py'), order.photo, photoReady]));
  if (ph.needs_review) review.push(...ph.reasons);
  // 4. шари
  const bn = renderBookName(nm.nominative, { ...T.book_name, font: T.book_name.font }, path.join(ROOT, 'assets'), out);
  if (!bn.fits) review.push('name_does_not_fit');
  const pSeg = T.seg[T.portrait_photo.segment];
  const portrait = renderPortrait(path.join(A, pSeg.still), photoReady, T.portrait_photo, out);
  const portraitBig = path.join(out, 'portrait_x2.png'); // збільшуємо 2x один раз, щоб наїзд камери був плавним (без «тремтіння»)
  sh('convert', [portrait, '-filter', 'Lanczos', '-resize', '200%', portraitBig]);
  const [pw, ph2] = sh('convert', [portraitBig, '-format', '%w %h', 'info:']).trim().split(' ').map(Number);

  // 5. FFmpeg: один граф, одне кодування
  const inputs = [], fc = [];
  const addIn = (...a) => { inputs.push(...a); return inputs.filter(x => x === '-i').length - 1; };
  const vlabels = [];
  for (const s of T.segments) {
    let idx, chain;
    if (s.still) {
      idx = addIn('-loop', '1', '-framerate', String(T.fps), '-t', String(s.len), '-i', portraitBig);
      const n = Math.round(s.len * T.fps), [z0, z1] = s.zoom;
      const q = T.portrait_photo.frame_quad; const sc = pw / (sh('convert', [path.join(A, s.still), '-format', '%w', 'info:']) * 1);
      const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4 * sc, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4 * sc;
      const z = `${z0}+(${z1 - z0})*on/${n - 1}`;
      // наїзд до центру рамки: точка інтересу зміщується від центру кадру до рамки
      const x = `max(0,min(iw-iw/zoom,(iw/2+(${cx}-iw/2)*on/${n - 1})-iw/zoom/2))`;
      const y = `max(0,min(ih-ih/zoom,(ih/2+(${cy}-ih/2)*on/${n - 1})-ih/zoom/2))`;
      chain = `[${idx}:v]zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${T.width}x${T.height}:fps=${T.fps}`;
    } else {
      idx = addIn('-ss', String(s.in), '-t', String(s.dur), '-i', path.join(A, s.src));
      chain = `[${idx}:v]fps=${T.fps},scale=${T.width}:${T.height}:flags=lanczos,setsar=1`;
      if (s.freeze) chain += `,tpad=stop_mode=clone:stop_duration=${s.freeze}`;
    }
    chain += `,setpts=PTS-STARTPTS`;
    if (s.id === T.book_name.segment) {
      const ink = addIn('-loop', '1', '-framerate', String(T.fps), '-t', String(s.len), '-i', bn.ink);
      const glow = addIn('-loop', '1', '-framerate', String(T.fps), '-t', String(s.len), '-i', bn.glow);
      const tw = T.book_name.write_at, D = T.book_name.write_dur, F = 60, Wd = bn.bbox.w;
      const reveal = `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(((T-${tw})/${D}*(${Wd}+${F})-X)/${F},0,1)'`;
      fc.push(`${chain},format=gbrp[bk0]`);
      fc.push(`[${ink}:v]format=rgba,${reveal}[inkr]`);
      fc.push(`color=white:s=${T.width}x${T.height}:r=${T.fps}:d=${s.len}[wc]`);
      fc.push(`[wc][inkr]overlay=${bn.bbox.x}:${bn.bbox.y}:format=auto,format=gbrp[inkw]`);
      fc.push(`[bk0][inkw]blend=all_mode=multiply[bk1]`);
      fc.push(`[${glow}:v]format=rgba,${reveal}[glr]`);
      fc.push(`[bk1][glr]overlay=${bn.bbox.x}:${bn.bbox.y},format=yuv420p,settb=AVTB[v_${s.id}]`);
    } else {
      if (s.fade_out) chain += `,fade=t=out:st=${r3(s.len - s.fade_out)}:d=${s.fade_out}`;
      fc.push(`${chain},format=yuv420p,settb=AVTB[v_${s.id}]`);
    }
    vlabels.push(`v_${s.id}`);
  }
  let cur = vlabels[0];
  T.segments.slice(0, -1).forEach((s, i) => {
    const nxt = T.segments[i + 1], lab = i === T.segments.length - 2 ? 'vcat' : `x${i}`;
    fc.push(`[${cur}][${vlabels[i + 1]}]xfade=transition=fade:duration=${s.xfade}:offset=${r3(nxt.start)}[${lab}]`);
    cur = lab;
  });
  const snow = addIn('-stream_loop', '-1', '-i', path.join(A, T.snow.src));
  fc.push(`[${snow}:v]format=rgba,colorchannelmixer=aa=${T.snow.opacity}[snw]`);
  fc.push(`[vcat][snw]overlay=0:0:shortest=1,format=yuv420p[vout]`);

  // аудіо: окремий швидкий прохід у WAV (без втрат) + двопрохідна нормалізація гучності до точних -16 LUFS
  const au = T.audio, fms = au.slot_fade_ms / 1000;
  const ain = [], afc = [];
  const addA = (...x) => { ain.push(...x); return ain.filter(y => y === '-i').length - 1; };
  const mus = addA('-stream_loop', '-1', '-i', path.join(A, au.music));
  afc.push(`[${mus}:a]atrim=0:${T.total},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${au.music_gain_db}dB,afade=t=in:d=1.5,afade=t=out:st=${r3(T.total - 2.5)}:d=2.5[mus]`);
  const vox = [];
  if (au.voice_general && fs.existsSync(path.join(A, au.voice_general))) {
    const g = addA('-i', path.join(A, au.voice_general));
    afc.push(`[${g}:a]aformat=sample_rates=48000:channel_layouts=stereo[vg]`); vox.push('vg');
  } else review.push('voice_general_missing');
  for (const [k, f] of Object.entries(slots)) {
    const i = addA('-i', f), ms = Math.round(T.slots[k].global * 1000);
    afc.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=${fms},areverse,afade=t=in:d=${fms},areverse,adelay=${ms}|${ms}[${k}]`);
    vox.push(k);
  }
  afc.push(`${vox.map(v => `[${v}]`).join('')}amix=inputs=${vox.length}:normalize=0:duration=longest,apad=whole_dur=${T.total},asplit=2[vox][key]`);
  afc.push(`[mus][key]sidechaincompress=threshold=0.015:ratio=3:attack=25:release=450[musd]`); // музика тихішає під голосом (~6 дБ)
  afc.push(`[musd][vox]amix=inputs=2:normalize=0:duration=first,atrim=0:${T.total}[aout]`);
  const mixRaw = path.join(out, 'mix_raw.wav'), mix = path.join(out, 'mix.wav');
  sh('ffmpeg', ['-v', 'error', '-y', ...ain, '-filter_complex', afc.join(';'), '-map', '[aout]', '-c:a', 'pcm_s24le', mixRaw]);
  const m = spawnSync('ffmpeg', ['-nostats', '-i', mixRaw, '-af', `loudnorm=I=${au.target_lufs}:TP=${au.true_peak}:LRA=11:print_format=json`, '-f', 'null', '-']).stderr.toString();
  const j = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1));
  sh('ffmpeg', ['-v', 'error', '-y', '-i', mixRaw, '-af', `loudnorm=I=${au.target_lufs}:TP=${au.true_peak}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, '-c:a', 'pcm_s24le', mix]);
  const mixIdx = addIn('-i', mix);
  fc.push(`[${mixIdx}:a]anull[aout]`);

  const outFile = path.join(out, `${order.id}.mp4`);
  const args = ['-v', 'error', '-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', String(T.total),
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', String(T.output.crf), '-preset', T.output.preset, '-pix_fmt', 'yuv420p', '-r', String(T.fps),
    '-c:a', 'aac', '-b:a', T.output.audio_bitrate, '-ar', '48000', '-movflags', '+faststart', outFile];
  fs.writeFileSync(path.join(out, 'ffmpeg_args.json'), JSON.stringify(args, null, 1));
  const tr = Date.now();
  const res = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 64 << 20 });
  if (res.status !== 0) throw new Error('ffmpeg: ' + res.stderr.toString().slice(-2000));
  const qc = runQc(outFile, { expectedDuration: T.total, targetLufs: au.target_lufs });
  if (!qc.ok) review.push(...qc.problems);
  const result = { id: order.id, name: nm, video: outFile, photo: ph, book: { fits: bn.fits, pointsize: bn.pointsize },
    qc, needsReview: review.length > 0, reviewReasons: [...new Set(review)], renderSeconds: (Date.now() - tr) / 1000, totalSeconds: (Date.now() - t0) / 1000,
    status: review.length ? 'needs_review' : 'done' };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

module.exports = { render, loadTemplate };
