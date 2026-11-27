'use strict';
// Автоматичний контроль якості готового відео.
const { execFileSync, spawnSync } = require('child_process');
function runQc(file, { expectedDuration, targetLufs = -16 }) {
  const problems = [];
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  if (Math.abs(dur - expectedDuration) > 0.1) problems.push(`duration_${dur.toFixed(2)}_vs_${expectedDuration}`);
  const r = spawnSync('ffmpeg', ['-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 64 << 20 });
  const log = r.stderr.toString();
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const I = parseFloat((summary.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  const TP = parseFloat((summary.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  if (!(Math.abs(I - targetLufs) <= 1)) problems.push(`loudness_${I}`);
  if (!(TP < -0.5)) problems.push(`clipping_peak_${TP}`);
  const v = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height,codec_name,profile', '-of', 'json', file]).toString();
  return { ok: problems.length === 0, duration: dur, lufs: I, truePeak: TP, video: JSON.parse(v).streams[0], problems };
}
module.exports = { runQc };
