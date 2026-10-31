// Fresh-account demo: rehearsal, paced presentation, or a verified 180-second MP4.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const auto = process.argv.includes('--auto');
const exportIndex = process.argv.indexOf('--export');
const exportOnly = exportIndex >= 0 ? process.argv[exportIndex + 1] : undefined;
if (exportIndex >= 0 && !exportOnly) throw new Error('--export requires a recording directory.');
const record = process.argv.includes('--record') || !!exportOnly;
const sourceFingerprint = async () => {
  const hash = createHash('sha256');
  let files = 0;
  const walk = async directory => {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { hash.update(path); hash.update(await readFile(resolve(root, path))); files++; }
    }
  };
  await walk('apps/web/src');
  await walk('apps/api/src');
  return { sha256: hash.digest('hex'), files };
};
const run = (command, args, options = {}) => new Promise((done, fail) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  child.on('error', fail);
  child.on('exit', (code, signal) => code === 0 ? done() : fail(new Error(`${command} exited with ${code ?? signal}`)));
});
const probe = file => new Promise((done, fail) => {
  const child = spawn('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', fail);
  child.on('exit', code => {
    if (code !== 0) return fail(new Error(`ffprobe failed: ${code}`));
    try { done(JSON.parse(output)); } catch (error) { fail(error); }
  });
});
const visibleStart = file => new Promise((done, fail) => {
  // Newly created browser tabs start white. Remove that loading flash before crossfading dark scenes.
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', '3', '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-an', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', fail);
  child.on('exit', code => {
    if (code !== 0) return fail(new Error('Could not inspect the recording opening.'));
    let time = 0;
    for (const line of output.split(/\r?\n/)) {
      const timestamp = line.match(/pts_time:([\d.]+)/);
      if (timestamp) time = Number(timestamp[1]);
      const brightness = line.match(/lavfi.signalstats.YAVG=([\d.]+)/);
      if (brightness && Number(brightness[1]) < 180) return done(time);
    }
    fail(new Error('No dark application frame found in the first three seconds.'));
  });
});

try {
  let source = record ? await sourceFingerprint() : undefined;
  const recordingDir = exportOnly ? resolve(root, exportOnly) : record ? resolve(root, 'e2e/videos', new Date().toISOString().replace(/[:.]/g, '-')) : undefined;
  if (exportOnly) source = JSON.parse(await readFile(resolve(recordingDir, 'verified.json'), 'utf8')).source;
  if (record) {
    await run('ffmpeg', ['-version'], { stdio: 'ignore' });
    await run('ffprobe', ['-version'], { stdio: 'ignore' });
    await mkdir(recordingDir, { recursive: true });
  }
  const env = { ...process.env };
  delete env.DEMO;
  delete env.DEMO_RECORD_DIR;
  if (auto) env.DEMO = '1';
  if (record) env.DEMO_RECORD_DIR = recordingDir;
  if (!exportOnly) await run(process.execPath, [resolve(root, 'node_modules/playwright/cli.js'), 'test', '-c', 'e2e/playwright.config.ts', '12-demo', '--reporter=list', '--retries=0'], { env });
  if (record) {
    if ((await sourceFingerprint()).sha256 !== source.sha256) throw new Error('Application source changed during recording. Run demo:record again to capture the latest version.');
    const scenes = JSON.parse(await readFile(resolve(recordingDir, 'scenes.json'), 'utf8'));
    if (scenes.length !== 6 || scenes.reduce((sum, scene) => sum + scene.seconds, 0) !== 180) throw new Error('Expected six scenes totaling 180 seconds.');
    for (const [index, scene] of scenes.entries()) {
      const metadata = await probe(scene.file);
      const duration = Number(metadata.format.duration);
      if (!(duration > 0)) throw new Error(`Invalid recording: ${scene.file}`);
      const leadIn = await visibleStart(scene.file);
      // Keep every action; fit the complete scene to its slot without cutting the ending.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(leadIn), '-i', scene.file,
        '-vf', `setpts=${scene.seconds / (duration - leadIn)}*(PTS-STARTPTS),fps=25,tpad=stop_mode=clone:stop_duration=${scene.seconds}`,
        '-frames:v', String(scene.seconds * 25), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        resolve(recordingDir, `part-${index + 1}.mp4`)]);
    }
    const output = resolve(recordingDir, 'careerpilot-demo-3min.mp4');
    const transitions = [];
    let elapsed = scenes[0].seconds;
    let previous = '0:v';
    for (let index = 1; index < scenes.length; index++) {
      const next = `fade${index}`;
      transitions.push(`[${previous}][${index}:v]xfade=transition=fade:duration=0.4:offset=${(elapsed - index * 0.4).toFixed(2)}[${next}]`);
      previous = next;
      elapsed += scenes[index].seconds;
    }
    // Restore the two seconds overlapped by crossfades as a readable closing hold.
    transitions.push(`[${previous}]tpad=stop_mode=clone:stop_duration=2,format=yuv420p[video]`);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...scenes.flatMap((_, index) => ['-i', resolve(recordingDir, `part-${index + 1}.mp4`)]),
      '-filter_complex_threads', '2', '-filter_complex', transitions.join(';'), '-map', '[video]',
      '-frames:v', '4500', '-r', '25', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart', output]);
    const metadata = await probe(output);
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    if (Number(metadata.format.duration) !== 180 || Number(video?.nb_frames) !== 4500 || video.width !== 1440 || video.height !== 900 || video.avg_frame_rate !== '25/1') throw new Error('Export failed verification: expected 180 seconds / 4500 frames / 25 fps / 1440x900.');
    await writeFile(resolve(recordingDir, 'verified.json'), JSON.stringify({ file: output, duration: 180, frames: 4500, fps: 25, width: video.width, height: video.height, theme: 'dark', captions: 'English, section-by-section guided scroll', source, audio: false, ai: 'local mock provider', profile: 'fresh account; no sample data', scenes }, null, 2));
    console.log(`\nVerified: 180.000 seconds, 4500 frames at 25 fps.\nVideo: ${output}`);
  }
} catch (error) {
  console.error(`Demo failed: ${error.message}`);
  process.exitCode = 1;
}
