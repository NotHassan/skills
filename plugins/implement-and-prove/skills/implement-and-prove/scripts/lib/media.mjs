import fs from 'node:fs';
import path from 'node:path';
import { exec, invariant } from './common.mjs';

export function probe(file) {
  invariant(fs.existsSync(file), `Missing input: ${file}`);
  const data = JSON.parse(exec(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path.resolve(file)]).stdout);
  invariant(data.streams.some(s => s.codec_type === 'video'), 'Input has no video stream.');
  const duration = Number(data.format.duration);
  invariant(Number.isFinite(duration) && duration > 0, 'Video duration is unavailable.');
  return { duration, streams: data.streams };
}
// Fit one input into a labelled box. `holdFrom` marks where a clip starts holding its final
// frame; the note is shown only from that moment so the label never misdescribes live footage.
function normalize(index, width, height, label, { hold = 0, holdFrom = 0, still = false } = {}) {
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  // Reset timestamps before fps: in the other order tpad silently stops extending the clip.
  const timing = still ? '' : ',setpts=PTS-STARTPTS,fps=30';
  const header = `pad=iw:ih+48:0:48,drawtext=text='${label}':fontsize=23:fontcolor=white:x=20:y=12`;
  const held = hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${hold.toFixed(6)},drawtext=text='final frame held':fontsize=19:fontcolor=0xFFD166:x=w-tw-20:y=14:enable='gte(t,${holdFrom.toFixed(3)})'` : '';
  return `[${index}:v]${fit}${timing},${header}${held}[v${index}]`;
}
export function media({ before, after, input, out, format = 'side-by-side', maxMB = 9.5 }) {
  invariant(['side-by-side', 'sequential', 'single', 'still-pair'].includes(format), 'Unknown media format.');
  const extension = format === 'still-pair' ? '.png' : '.mp4';
  invariant(out && out.endsWith(extension), `Output for ${format} must be a ${extension} file.`);
  invariant(!fs.existsSync(out), 'Refusing to overwrite existing media. Choose a new output path.');
  invariant(Number.isFinite(maxMB) && maxMB > 0, 'maxMB must be positive.');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true, mode: 0o700 });
  if (format === 'still-pair') {
    for (const file of [before, after]) invariant(file && fs.existsSync(file), `Missing input: ${file}`);
    const filter = [normalize(0, 960, 540, 'BEFORE', { still: true }), normalize(1, 960, 540, 'AFTER', { still: true }), '[v0][v1]hstack=inputs=2[out]'].join(';');
    const result = exec(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path.resolve(before), '-i', path.resolve(after), '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', path.resolve(out)], { timeoutMs: 60000, check: false });
    invariant(result.code === 0, `FFmpeg failed: ${result.stderr || result.error}`);
    return { format, file: path.resolve(out), bytes: fs.statSync(out).size, layout: 'Before and after screenshots side by side, each scaled to fit 960x540.' };
  }
  let args, filter;
  let details;
  if (format === 'single') {
    const info = probe(input); args = ['-i', path.resolve(input)];
    filter = `${normalize(0, 1280, 720, 'WALKTHROUGH')} ; [v0]null[out]`;
    details = { format, duration: info.duration, timing: 'Original timing; no speed changes.' };
  } else {
    const a = probe(before), b = probe(after);
    args = ['-i', path.resolve(before), '-i', path.resolve(after)];
    const sideBySide = format === 'side-by-side';
    const duration = sideBySide ? Math.max(a.duration, b.duration) : a.duration + b.duration;
    const width = sideBySide ? 960 : 1280, height = sideBySide ? 540 : 720;
    const holdA = sideBySide ? Math.max(0, duration - a.duration) : 0;
    const holdB = sideBySide ? Math.max(0, duration - b.duration) : 0;
    filter = [
      normalize(0, width, height, 'BEFORE', holdA > 0.05 ? { hold: holdA, holdFrom: a.duration } : {}),
      normalize(1, width, height, 'AFTER', holdB > 0.05 ? { hold: holdB, holdFrom: b.duration } : {}),
      `[v0][v1]${sideBySide ? 'hstack=inputs=2' : 'concat=n=2:v=1:a=0'}[out]`
    ].join(';');
    details = { format, duration, beforeDuration: a.duration, afterDuration: b.duration, timing: sideBySide ? 'Clip-start aligned, not action synchronized. The shorter clip holds its final frame, marked "final frame held" while held; no time scaling.' : 'Before followed by after; original timing.' };
  }
  let last;
  for (const crf of [24, 28, 32]) {
    last = exec(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args, '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(out)], { timeoutMs: 180000, check: false });
    invariant(last.code === 0, `FFmpeg failed: ${last.stderr || last.error}`);
    if (fs.statSync(out).size <= maxMB * 1024 * 1024) return { ...details, file: path.resolve(out), bytes: fs.statSync(out).size, crf };
  }
  throw new Error(`Video exceeds ${maxMB} MiB even at CRF 32. Kept ${out}; curate a shorter clip or explicitly raise --max-mb after checking repository limits.`);
}
