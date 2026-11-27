'use strict';
// Рендер замовлення поверх мастера з VN: голос імені + золоте ім'я в книзі + фото в чорну (хромакей) зону.
// Одне кодування відео, мастер ніде не перекодовується двічі.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveName } = require('./names');
const { renderBookName } = require('./layers');

const ROOT = path.join(__dirname, '..');
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();
const durationOf = (f) => parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));
const meanDb = (f) => parseFloat(spawnSync('ffmpeg', ['-nostats', '-i', f, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,volumedetect', '-f', 'null', '-'])
  .stderr.toString().match(/mean_volume: (-?[\d.]+) dB/)[1]);

function loadMaster(p) {
  const M = JSON.parse(fs.readFileSync(p, 'utf8'));
  M.dir = path.dirname(path.resolve(p));
  M.videoPath = process.env.MASTER_VIDEO || path.resolve(M.dir, M.video);
  if (process.env.RENDER_PRESET) M.output = { ...(M.output || {}), preset: process.env.RENDER_PRESET };
  const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', M.videoPath]));
  const s = j.streams[0], [n, d] = s.r_frame_rate.split('/').map(Number);
  Object.assign(M, { width: s.width, height: s.height, fps: n / d, duration: parseFloat(j.format.duration) });
  return M;
}

/**
 * order = { id, name, photo, master: 'шлях до master.json', outDir, voiceFile?, allowSpend?, stubVoice? }
 */
async function renderMaster(order) {
  const t0 = Date.now();
  const M = loadMaster(order.master);
  const out = order.outDir; fs.mkdirSync(out, { recursive: true });
  const review = [];
  const nm = resolveName(order.name);
  if (!nm.ok) throw new Error(`Некоректне ім'я: ${order.name}`);
  if (nm.needsReview) review.push(...nm.reviewReasons);

  // 1. голос імені: готовий файл > кеш/ElevenLabs > заглушка
  const NV = M.name_voice || null;
  let voice = order.voiceFile;
  if (!NV) review.push('no_name_voice_slot');
  if (NV && !voice && order.stubVoice) {
    voice = path.join(out, 'name_stub.wav');
    sh('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*660*t)*exp(-3*mod(t\\,0.6)):s=48000:d=2.6', voice]);
    review.push('voice_stub');
  }
  if (NV && !voice) {
    const { getSlotAudio } = require('./voice');
    voice = (await getSlotAudio(nm.tts_vocative, { allowSpend: !!order.allowSpend, only: [NV.slot] })).files[NV.slot];
  }
  const vDur = voice ? durationOf(voice) : 0;
  if (NV && NV.max_dur && vDur > NV.max_dur) review.push(`name_voice_too_long_${vDur.toFixed(2)}s`);
  // гучність як у твоєму оригінальному записі імені
  const gain = NV && voice && NV.orig_mean_db != null ? Math.max(-12, Math.min(12, NV.orig_mean_db - meanDb(voice))) : 0;

  // 2. фото
  const photoReady = path.join(out, 'photo_ready.png');
  const ph = JSON.parse(sh('python3', [path.join(ROOT, 'tools', 'photo_prep.py'), order.photo, photoReady]));
  if (ph.needs_review) review.push(...ph.reasons);

  // 3. ім'я в книзі (PNG без втрат, corner-pin на сторінку)
  const B = M.book;
  const bn = renderBookName(nm.nominative, B, path.join(ROOT, 'assets'), out);
  if (!bn.fits) review.push('name_does_not_fit');

  // 4. один граф FFmpeg
  const inputs = ['-i', M.videoPath], fc = [];
  const addIn = (...a) => { inputs.push(...a); return inputs.filter(x => x === '-i').length - 1; };
  const r = (x) => Math.round(x * 1000) / 1000;
  let cur = '0:v';

  // 4a. фото
  const P = M.photo;
  if (P && P.mode === 'canvas') {
    // бежеве полотно без хромакею: окремий інструмент рахує маску, тінь і наїзд кадр за кадром
    const ovFile = path.join(out, 'portrait_overlay.mkv');
    const cfgFile = path.join(out, 'portrait_cfg.json');
    fs.writeFileSync(cfgFile, JSON.stringify(P));
    const reuse = order.reuseOverlay && fs.existsSync(ovFile) && fs.existsSync(ovFile + '.json');
    const ovr = reuse ? { ok: true } : JSON.parse(sh('python3', [path.join(ROOT, 'tools', 'portrait_overlay.py'), M.videoPath, cfgFile, photoReady, ovFile]).trim().split('\n').pop());
    const ov = JSON.parse(fs.readFileSync(ovFile + '.json', 'utf8'));
    const oi = addIn('-i', ovFile);
    fc.push(`[${oi}:v]format=rgba,setpts=PTS-STARTPTS+${ov.t0}/TB[pov]`);
    fc.push(`[${cur}][pov]overlay=${ov.x}:${ov.y}:eof_action=pass:format=auto[v1]`);
    cur = 'v1';
    if (!ovr.ok) review.push('portrait_overlay_failed');
  } else if (P) {
    const [x, y, w, h] = P.rect;
    const pi = addIn('-loop', '1', '-framerate', String(M.fps), '-t', String(M.duration), '-i', photoReady);
    fc.push(`[${pi}:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},` +
      (P.tint ? `colorbalance=rm=${P.tint}:gm=${P.tint / 2}:bm=${-P.tint},` : '') + `format=yuv444p,setsar=1[ph]`);
    fc.push(`[${cur}]split=2[base][forkey]`);
    fc.push(`[forkey]crop=${w}:${h}:${x}:${y},format=yuva444p,colorkey=0x000000:${P.similarity ?? 0.08}:${P.blend ?? 0.04}[keyed]`);
    fc.push(`[ph][keyed]overlay=0:0:shortest=1[phk]`);
    fc.push(`[base][phk]overlay=${x}:${y}:enable='between(t,${P.t0},${P.t1})'[v1]`);
    cur = 'v1';
  }

  // 4b. ім'я: чорнило множенням (вбирається в папір) + м'яке золоте сяйво, проявляється зліва направо
  if (B) {
    const bb = bn.bbox, tw = B.write_at, D = B.write_dur, F = 60;
    const ink = addIn('-loop', '1', '-framerate', String(M.fps), '-t', String(B.t1), '-i', bn.ink);
    const glow = addIn('-loop', '1', '-framerate', String(M.fps), '-t', String(B.t1), '-i', bn.glow);
    const reveal = `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(((T-${tw})/${D}*(${bb.w}+${F})-X)/${F},0,1)'`;
    fc.push(`[${cur}]split=2[bbase][bsrc]`);
    fc.push(`[bsrc]crop=${bb.w}:${bb.h}:${bb.x}:${bb.y},format=gbrp[bpage]`);
    fc.push(`[${ink}:v]format=rgba,${reveal}[inkr]`);
    fc.push(`color=white:s=${bb.w}x${bb.h}:r=${M.fps}:d=${B.t1}[wc]`);
    fc.push(`[wc][inkr]overlay=0:0:format=auto,format=gbrp[inkw]`);
    fc.push(`[bpage][inkw]blend=all_mode=multiply:shortest=0[bmul]`);
    fc.push(`[${glow}:v]format=rgba,${reveal}[glr]`);
    fc.push(`[bmul][glr]overlay=0:0:eof_action=pass[bdone]`);
    fc.push(`[bbase][bdone]overlay=${bb.x}:${bb.y}:eof_action=pass:enable='between(t,${B.t0},${B.t1})'[v2]`);
    cur = 'v2';
  }
  fc.push(`[${cur}]format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[vout]`);

  // 4c. звук: твій мікс з мастера + нове ім'я на тому ж місці і тій самій гучності
  if (NV && voice) {
    const ms = Math.round(NV.at * 1000), fd = 0.03;
    const vi = addIn('-i', voice);
    fc.push(`[${vi}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${r(gain)}dB,afade=t=in:d=${fd},areverse,afade=t=in:d=${fd},areverse,adelay=${ms}|${ms}[nv]`);
    const duck = NV.duck_db || 0;
    fc.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo` +
      (duck ? `,volume=enable='between(t,${NV.at},${r(NV.at + vDur)})':volume=${-duck}dB` : '') + `[ma]`);
    fc.push(`[ma][nv]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95:level=disabled[aout]`);
  } else {
    fc.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo[aout]`);
  }

  const O = M.output || {};
  const outFile = path.join(out, `${order.id}.mp4`);
  const args = ['-v', 'error', '-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', String(M.duration),
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', String(O.crf ?? 16), '-preset', O.preset || 'slow', '-pix_fmt', 'yuv420p', '-r', String(M.fps),
    '-c:a', 'aac', '-b:a', O.audio_bitrate || '256k', '-ar', '48000', '-movflags', '+faststart', outFile];
  fs.writeFileSync(path.join(out, 'ffmpeg_args.json'), JSON.stringify(args, null, 1));
  const tr = Date.now();
  const res = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 64 << 20 });
  if (res.status !== 0) throw new Error('ffmpeg: ' + res.stderr.toString().slice(-2000));
  const dur = durationOf(outFile);
  if (Math.abs(dur - M.duration) > 0.1) review.push(`duration_${dur.toFixed(2)}`);
  const result = { id: order.id, name: nm, video: outFile, voice: voice ? { file: voice, dur: vDur, gainDb: r(gain) } : null, photo: ph,
    book: { fits: bn.fits, pointsize: bn.pointsize }, needsReview: review.length > 0, reviewReasons: [...new Set(review)],
    renderSeconds: (Date.now() - tr) / 1000, totalSeconds: (Date.now() - t0) / 1000, status: review.length ? 'needs_review' : 'done' };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

module.exports = { renderMaster, loadMaster };

if (require.main === module) {
  // node src/render-master.js --master master/master.json --name Arsenije --photo foto.jpg --out out/arsenije [--voice ime.mp3] [--stub-voice] [--allow-spend]
  const a = process.argv.slice(2); const g = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  renderMaster({ id: g('--id') || (g('--name') || 'test').toLowerCase(), name: g('--name'), photo: g('--photo'), master: g('--master'), outDir: g('--out'),
    voiceFile: g('--voice'), reuseOverlay: a.includes('--reuse-overlay'), stubVoice: a.includes('--stub-voice'), allowSpend: a.includes('--allow-spend') })
    .then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exit(1); });
}
