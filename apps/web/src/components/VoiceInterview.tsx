import { Check, Download, Flag, Mic, MicOff, Pause, Play, RotateCcw, Trash2, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteRecording, getRecording, RECORDING_SAVED_EVENT, saveRecording, type RecordingMarker, type StoredRecording } from '../lib/recordings';
import { Button, Card, cx, Notice, Pill } from './ui';
import { getCtor, type SpeechRecognitionLike } from './VoiceTextarea';

/**
 * Voice mock interview: the interviewer reads each question aloud (speech synthesis), the answer is
 * transcribed live (Web Speech API) into an editable box, and the session can be recorded as video
 * or audio for replay. Media never leaves the browser; only the transcript is sent to the API.
 */

export type RecordMode = 'video' | 'audio' | 'none';
export interface VoicePrefs { mode: RecordMode; voiceURI: string | null }

const prefsKey = (id: number) => `cp-voice-${id}`;
export function loadVoicePrefs(id: number): VoicePrefs | null {
  try { return JSON.parse(sessionStorage.getItem(prefsKey(id)) ?? 'null'); } catch { return null; }
}
function storeVoicePrefs(id: number, p: VoicePrefs) {
  try { sessionStorage.setItem(prefsKey(id), JSON.stringify(p)); } catch { /* storage unavailable */ }
}

const speechLang = (language: string) => (language === 'vi' ? 'vi-VN' : 'en-US');
const fmtTime = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Media hooks
// ---------------------------------------------------------------------------

/** Camera + microphone stream. Lives in the session page so it survives the setup → live switch. */
export function useMediaSession() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const ref = useRef<MediaStream | null>(null);

  const request = useCallback(async (opts: { video: boolean; audioId?: string; videoId?: string }) => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, ...(opts.audioId ? { deviceId: { exact: opts.audioId } } : {}) },
        video: opts.video ? { width: { ideal: 1280 }, height: { ideal: 720 }, ...(opts.videoId ? { deviceId: { exact: opts.videoId } } : {}) } : false,
      });
      ref.current?.getTracks().forEach((t) => t.stop());
      ref.current = s;
      setStream(s);
      setMicOn(true);
      setCamOn(opts.video);
      return s;
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'Camera or microphone access is blocked. Allow it from the icon in the address bar, then try again.'
        : 'Could not start your camera or microphone. Check that no other app is using it.');
      return null;
    }
  }, []);
  const setMic = useCallback((on: boolean) => { ref.current?.getAudioTracks().forEach((t) => { t.enabled = on; }); setMicOn(on); }, []);
  const setCam = useCallback((on: boolean) => { ref.current?.getVideoTracks().forEach((t) => { t.enabled = on; }); setCamOn(on); }, []);
  const stop = useCallback(() => { ref.current?.getTracks().forEach((t) => t.stop()); ref.current = null; setStream(null); }, []);
  useEffect(() => () => ref.current?.getTracks().forEach((t) => t.stop()), []);
  return { stream, error, micOn, camOn, hasVideo: !!stream?.getVideoTracks().length, request, setMic, setCam, stop };
}
export type MediaSession = ReturnType<typeof useMediaSession>;

/** Input level 0..1 from the stream's audio track (0 when muted). */
function useAudioLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream?.getAudioTracks().length) { setLevel(0); return; }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const id = window.setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 5));
    }, 90);
    return () => { clearInterval(id); src.disconnect(); void ctx.close(); };
  }, [stream]);
  return level;
}

function useVoices(language: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(language)));
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, [language]);
  return voices;
}

function speak(text: string, language: string, voiceURI: string | null) {
  return new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { resolve(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(language);
    const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI);
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

/** Continuous recognition that restarts itself after silence until stopped; final phrases go to onFinal. */
function useSpeech(language: string, onFinal: (text: string) => void) {
  const supported = typeof window !== 'undefined' && !!getCtor();
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const want = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    const C = getCtor();
    if (!C || want.current) return;
    want.current = true;
    const run = () => {
      const r = new C();
      r.lang = speechLang(language);
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let fin = '';
        let int = '';
        for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (int += e.results[i][0].transcript));
        if (fin.trim()) finalRef.current(fin.trim());
        setInterim(int);
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed') { want.current = false; setError('Microphone permission denied, so speech can’t be transcribed. You can still type.'); }
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Speech recognition stopped (${e.error}). Press the mic to try again or type your answer.`);
      };
      r.onend = () => {
        setInterim('');
        if (want.current) { try { run(); } catch { want.current = false; setListening(false); } } else setListening(false);
      };
      rec.current = r;
      setError(null);
      r.start();
      setListening(true);
    };
    run();
  }, [language]);
  const stop = useCallback(() => { want.current = false; rec.current?.stop(); setListening(false); setInterim(''); }, []);
  useEffect(() => () => { want.current = false; rec.current?.stop(); }, []);
  return { supported, listening, interim, error, start, stop };
}

function pickMime(kind: 'video' | 'audio') {
  const options = kind === 'video' ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** MediaRecorder with pause/resume and question markers on the recording's own clock (pauses excluded). */
function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const markers = useRef<RecordingMarker[]>([]);
  const kind = useRef<'video' | 'audio'>('audio');
  const startedAt = useRef(0);
  const pausedTotal = useRef(0);
  const pausedAt = useRef<number | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const now = () => Math.max(0, ((pausedAt.current ?? performance.now()) - startedAt.current - pausedTotal.current) / 1000);

  useEffect(() => {
    if (state === 'idle') return;
    const id = window.setInterval(() => setElapsed(now()), 500);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback((stream: MediaStream, k: 'video' | 'audio') => {
    if (rec.current || typeof MediaRecorder === 'undefined') return;
    const mime = pickMime(k);
    const r = new MediaRecorder(k === 'audio' ? new MediaStream(stream.getAudioTracks()) : stream, mime ? { mimeType: mime } : undefined);
    // Each recorder owns its arrays, so a late `stop` never reads data from a newer take.
    const parts: Blob[] = [];
    chunks.current = parts;
    markers.current = [];
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    r.start(1000);
    rec.current = r;
    kind.current = k;
    startedAt.current = performance.now();
    pausedTotal.current = 0;
    pausedAt.current = null;
    setElapsed(0);
    setState('recording');
  }, []);
  const pause = useCallback(() => {
    if (rec.current?.state !== 'recording') return;
    rec.current.pause();
    pausedAt.current = performance.now();
    setState('paused');
  }, []);
  const resume = useCallback(() => {
    if (rec.current?.state !== 'paused') return;
    rec.current.resume();
    pausedTotal.current += performance.now() - (pausedAt.current ?? performance.now());
    pausedAt.current = null;
    setState('recording');
  }, []);
  const mark = useCallback((label: string) => { if (rec.current) markers.current.push({ t: now(), label }); }, []);
  const stop = useCallback(() => new Promise<Omit<StoredRecording, 'sessionId' | 'createdAt'> | null>((resolve) => {
    const r = rec.current;
    if (!r) { resolve(null); return; }
    rec.current = null;
    const durationSec = now();
    const parts = chunks.current;
    const marks = markers.current;
    const k = kind.current;
    const done = () => {
      const mime = r.mimeType || pickMime(k);
      resolve({ blob: new Blob(parts, { type: mime }), mime, kind: k, markers: marks, durationSec });
    };
    if (r.state === 'inactive') done();
    else { r.onstop = done; r.stop(); }
    setState('idle');
  }), []);
  return { state, elapsed, start, pause, resume, mark, stop };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const BAR_SHAPE = [0.35, 0.6, 0.9, 0.55, 0.75, 1, 0.7, 0.45, 0.8, 0.6, 0.4, 0.3];
function LevelBars({ level, color = 'bg-success', bars = 12, height = 24 }: { level: number; color?: string; bars?: number; height?: number }) {
  return (
    <span className="inline-flex items-end gap-[3px]" style={{ height }} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} className={cx('w-1 rounded-full transition-[height] duration-100', level > 0.02 ? color : 'bg-white/30')} style={{ height: Math.max(3, height * Math.min(1, level * 1.6) * BAR_SHAPE[i % BAR_SHAPE.length]) }} />
      ))}
    </span>
  );
}

function SelfView({ stream, className }: { stream: MediaStream; className?: string }) {
  return <video ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} autoPlay muted playsInline className={cx('size-full -scale-x-100 object-cover', className)} />;
}

function RoundButton({ on, onClick, label, children, danger }: { on: boolean; onClick: () => void; label: string; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={!on} title={label}
      className={cx('inline-flex size-14 items-center justify-center rounded-full border transition-colors', on ? 'border-line bg-surface text-ink hover:border-primary/50' : danger ? 'border-rec bg-rec text-white' : 'border-line bg-surface-2 text-muted')}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Setup (device check before the first question)
// ---------------------------------------------------------------------------

const MODES: { id: RecordMode; title: string; desc: string; tag: string }[] = [
  { id: 'video', title: 'Video + audio', desc: 'Review eye contact, posture and pace afterwards', tag: 'Best feedback' },
  { id: 'audio', title: 'Audio only', desc: 'Lighter files, focus on what you say', tag: 'Low bandwidth' },
  { id: 'none', title: 'Don’t record', desc: 'Transcript and scores only', tag: 'Private' },
];

export function VoiceSetup({ sessionId, language, name, chips, topics, media, starting, error, onJoin }: {
  sessionId: number; language: string; name?: string; chips: string[]; topics: { key: string; label: string }[];
  media: MediaSession; starting: boolean; error: Error | null; onJoin: (p: VoicePrefs) => void;
}) {
  const saved = loadVoicePrefs(sessionId);
  const [mode, setMode] = useState<RecordMode>(saved?.mode ?? 'video');
  const [voiceURI, setVoiceURI] = useState<string | null>(saved?.voiceURI ?? null);
  const [consent, setConsent] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const voices = useVoices(language);
  const level = useAudioLevel(media.stream);
  const speechOk = !!getCtor();
  const recorderOk = typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    if (!media.stream) return;
    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([]));
  }, [media.stream]);

  const choose = (m: RecordMode) => {
    setMode(m);
    if (media.stream && (m === 'video') !== media.hasVideo) void media.request({ video: m === 'video' });
  };
  const deviceId = (kind: 'audio' | 'video') => media.stream?.[kind === 'audio' ? 'getAudioTracks' : 'getVideoTracks']()[0]?.getSettings().deviceId ?? '';
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const needsConsent = mode !== 'none';
  const canJoin = !!media.stream && (!needsConsent || consent) && !starting;
  const effectiveMode: RecordMode = recorderOk ? mode : 'none';
  const join = () => { const p = { mode: effectiveMode, voiceURI }; storeVoicePrefs(sessionId, p); onJoin(p); };
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: !!media.stream && media.micOn, label: 'Microphone', detail: media.stream ? (media.micOn ? (level > 0.05 ? 'Hearing you clearly' : 'Say something to test the level') : 'Muted, unmute before joining') : 'Not turned on yet' },
    { ok: mode !== 'video' || (media.hasVideo && media.camOn), label: 'Camera', detail: mode !== 'video' ? 'Not needed for this mode' : media.hasVideo ? (media.camOn ? 'Looks good' : 'Turned off') : 'Not turned on yet' },
    { ok: speechOk, label: 'Live transcript', detail: speechOk ? 'Your speech becomes text you can edit' : 'Not supported in this browser, you will type instead (Chrome or Edge recommended)' },
  ];

  return (
    <div className="grid items-start gap-8 xl:grid-cols-2">
      <section aria-label="Camera and microphone check" className="flex flex-col gap-4">
        <div className="relative aspect-[16/10] min-h-[320px] overflow-hidden rounded-[24px] bg-stage text-white">
          {media.stream && media.hasVideo && media.camOn ? <SelfView stream={media.stream} /> : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <span className="flex size-24 items-center justify-center rounded-full bg-white/10 font-display text-[32px] font-bold">{(name ?? 'You').slice(0, 1).toUpperCase()}</span>
              {media.stream
                ? <span className="text-body-sm text-white/75">{mode === 'video' ? 'Camera is off' : 'Audio only'} · your microphone is on</span>
                : <><span className="max-w-sm text-body-sm text-white/75">Turn on your microphone{mode === 'video' ? ' and camera' : ''} to check how you sound before the interview starts.</span>
                  <Button variant="primary" icon={<Mic className="size-4" />} onClick={() => void media.request({ video: mode === 'video' })}>Turn on {mode === 'video' ? 'camera & mic' : 'microphone'}</Button></>}
            </div>
          )}
          <span className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-caption font-semibold">
            <span className={cx('size-2 rounded-full', media.stream ? 'bg-success' : 'bg-white/40')} />Preview · not recording yet
          </span>
          {media.stream && (
            <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => media.setMic(!media.micOn)} aria-label={media.micOn ? 'Mute microphone' : 'Unmute microphone'} className={cx('inline-flex size-12 items-center justify-center rounded-full', media.micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-rec')}>{media.micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}</button>
              {media.hasVideo && <button type="button" onClick={() => media.setCam(!media.camOn)} aria-label={media.camOn ? 'Turn camera off' : 'Turn camera on'} className={cx('inline-flex size-12 items-center justify-center rounded-full', media.camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-rec')}>{media.camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}</button>}
              <span className="ml-auto inline-flex items-center rounded-full bg-black/60 px-3.5 py-2" aria-label="Microphone level"><LevelBars level={level} /></span>
            </div>
          )}
        </div>
        {media.error && <Notice tone="warn">{media.error}</Notice>}
        {media.stream && (mics.length > 0 || cams.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-body-sm font-medium">Microphone
              <select className="rounded-md border border-line bg-surface px-3 py-2.5 text-body-sm" value={deviceId('audio')} onChange={(e) => void media.request({ video: media.hasVideo, audioId: e.target.value, videoId: deviceId('video') || undefined })}>
                {mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
              </select>
            </label>
            {media.hasVideo && <label className="flex flex-col gap-1.5 text-body-sm font-medium">Camera
              <select className="rounded-md border border-line bg-surface px-3 py-2.5 text-body-sm" value={deviceId('video')} onChange={(e) => void media.request({ video: true, videoId: e.target.value, audioId: deviceId('audio') || undefined })}>
                {cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>}
          </div>
        )}
        {topics.length > 0 && (
          <details className="card px-5 py-4">
            <summary className="cursor-pointer text-body-sm font-semibold">What we’ll cover ({topics.length} topics)</summary>
            <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-body-sm text-ink-2">{topics.map((t) => <li key={t.key}>{t.label}</li>)}</ol>
          </details>
        )}
      </section>

      <Card className="flex flex-col gap-5 rounded-[24px] p-7">
        <div className="flex flex-col gap-2">
          <span className="text-caption font-bold tracking-wider text-primary-ink uppercase">Voice interview</span>
          <h2 className="font-display text-[28px] leading-tight font-extrabold tracking-tight">Ready when you are{name ? `, ${name}` : ''}</h2>
          <div className="flex flex-wrap gap-2">{chips.map((c) => <span key={c} className="rounded-full bg-surface-2 px-3 py-1 text-caption font-semibold">{c}</span>)}</div>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 font-semibold">What should we record?</legend>
          {MODES.map((m) => {
            const on = mode === m.id;
            const disabled = m.id !== 'none' && !recorderOk;
            return (
              <label key={m.id} className={cx('flex min-h-15 cursor-pointer items-center gap-3.5 rounded-2xl border-2 px-4 py-2.5 transition-colors', on ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40', disabled && 'cursor-not-allowed opacity-50')}>
                <input type="radio" name="record-mode" className="size-4 accent-primary" checked={on} disabled={disabled} onChange={() => choose(m.id)} />
                <span className="flex flex-1 flex-col"><span className="font-semibold">{m.title}</span><span className="text-caption text-muted">{m.desc}</span></span>
                <span className={cx('rounded-full px-2 py-0.5 text-[12px] font-bold', m.id === 'video' ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-muted')}>{m.tag}</span>
              </label>
            );
          })}
        </fieldset>

        {voices.length > 0 && (
          <label className="flex flex-col gap-1.5 text-body-sm font-medium">Interviewer voice
            <select className="rounded-md border border-line bg-surface px-3 py-2.5 text-body-sm" value={voiceURI ?? ''} onChange={(e) => setVoiceURI(e.target.value || null)}>
              <option value="">Browser default</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
          </label>
        )}

        <ul className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2.5 text-body-sm">
              <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold', c.ok ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent-ink')}>{c.ok ? <Check className="size-3" /> : '!'}</span>
              <span><b className="font-semibold">{c.label}</b> <span className="text-muted">{c.detail}</span></span>
            </li>
          ))}
        </ul>

        {needsConsent && (
          <label className="flex cursor-pointer items-start gap-3 text-body-sm leading-relaxed">
            <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to record this session. The recording stays in this browser only, is never uploaded, and I can delete it anytime.</span>
          </label>
        )}

        <Button variant="primary" className="min-h-13 rounded-2xl text-body" icon={<Mic className="size-5" />} loading={starting} disabled={!canJoin} onClick={join}>
          {!media.stream ? 'Turn on your microphone to join' : needsConsent && !consent ? 'Tick the box above to join' : 'Join interview'}
        </Button>
        {error && <p className="text-body-sm text-vermillion">{error.message}</p>}
        <p className="-mt-2 text-center text-caption text-muted">Questions are read aloud. Pauses are fine, nothing is sent until you press “Done answering”.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live interview
// ---------------------------------------------------------------------------

interface LiveQuestion { id: number; content: string; kind: string; topicLabel?: string; rubricCriteria: string[] | null }
interface TranscriptLine { id: number; speaker: 'interviewer' | 'candidate'; content: string }

export function VoiceLive({ sessionId, language, title, subtitle, question, questionNumber, maxQuestions, history, media, prefs, sending, sendError, feedback, onSubmit, finishing, onFinish, onAbandon }: {
  sessionId: number; language: string; title: string; subtitle: string; question: LiveQuestion; questionNumber: number; maxQuestions: number;
  history: TranscriptLine[]; media: MediaSession; prefs: VoicePrefs; sending: boolean; sendError: Error | null; feedback: ReactNode;
  onSubmit: (text: string) => void; finishing: boolean; onFinish: () => void; onAbandon: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const recorder = useRecorder();
  const level = useAudioLevel(media.stream);
  const speech = useSpeech(language, (text) => setAnswer((a) => (a ? `${a.trimEnd()} ${text}` : text)));
  const recordKind: 'video' | 'audio' | null = prefs.mode === 'none' ? null : prefs.mode === 'video' && media.hasVideo ? 'video' : 'audio';
  const mutedRef = useRef(!media.micOn);
  mutedRef.current = !media.micOn || paused;

  // Save the recording when the call ends for any reason (finish, abandon, last question answered).
  // `ended` stops the start effect below from opening a new take while the last one is being saved.
  const ended = useRef(false);
  const finalize = useRef<() => Promise<void>>(async () => {});
  finalize.current = async () => {
    ended.current = true;
    speech.stop();
    window.speechSynthesis?.cancel();
    const r = await recorder.stop();
    if (r && r.blob.size > 0 && (r.markers.length > 0 || r.durationSec > 1)) await saveRecording({ sessionId, ...r, createdAt: new Date().toISOString() }).catch(() => undefined);
  };
  useEffect(() => {
    ended.current = false;
    return () => { void finalize.current(); };
  }, []);

  // Start recording once the stream is available (also after re-enabling devices on reload).
  useEffect(() => {
    if (!ended.current && recordKind && media.stream && recorder.state === 'idle') recorder.start(media.stream, recordKind);
  }, [media.stream, recordKind, recorder]);

  const ask = useCallback(async () => {
    speech.stop();
    setSpeaking(true);
    await speak(question.content, language, prefs.voiceURI);
    setSpeaking(false);
    if (!mutedRef.current) speech.start();
  }, [question.content, language, prefs.voiceURI, speech]);

  // Each new question: clear the answer box, drop a marker in the recording, read the question aloud.
  useEffect(() => {
    setAnswer('');
    recorder.mark(`${question.kind === 'follow_up' ? `Q${questionNumber} follow-up` : `Q${questionNumber}`}${question.topicLabel ? ` · ${question.topicLabel}` : ''}`);
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const toggleMic = () => {
    const on = !media.micOn;
    media.setMic(on);
    if (!on) speech.stop(); else if (!speaking && !paused) speech.start();
  };
  const togglePause = () => {
    if (paused) { recorder.resume(); setPaused(false); if (media.micOn) speech.start(); }
    else { recorder.pause(); speech.stop(); setPaused(true); }
  };
  const submit = () => { speech.stop(); onSubmit(answer.trim()); };
  const end = async () => { await finalize.current(); onFinish(); };

  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const status = paused ? ['Paused', 'Nothing is recorded or transcribed while paused.']
    : speaking ? ['Interviewer is asking…', 'Listen first. The question is also written below.']
    : !media.micOn ? ['You are muted', 'Unmute to answer out loud, or type in the box.']
    : speech.listening ? ['Your turn, take your time', 'Speak naturally. Pauses are fine, nothing is sent until you press Done.']
    : ['Your turn', speech.supported ? 'Press the mic to start the live transcript, or type.' : 'Type your answer in the box.'];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {recordKind ? (
          <span className={cx('inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-body-sm font-bold tabular-nums', paused ? 'bg-accent-soft text-accent-ink' : 'bg-rec-soft text-rec')}>
            <span className={cx('size-2.5 rounded-full', paused ? 'bg-marigold' : 'animate-pulse bg-rec')} />{paused ? 'PAUSED' : 'REC'} · {fmtTime(recorder.elapsed)}
          </span>
        ) : <Pill>Not recording</Pill>}
        <div className="flex min-w-0 flex-col">
          <h1 className="font-display text-[18px] font-bold">{title}</h1>
          <span className="text-caption text-muted">{subtitle}{recordKind && ` · recording ${recordKind === 'video' ? 'video + audio' : 'audio'}, kept in this browser only`}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-body-sm font-semibold">Question {questionNumber} of {maxQuestions}</span>
          <span className="flex gap-1" aria-hidden>{Array.from({ length: maxQuestions }).map((_, i) => <span key={i} className={cx('h-1.5 w-6 rounded-full', i < questionNumber - 1 ? 'bg-primary' : i === questionNumber - 1 ? 'bg-marigold' : 'bg-line')} />)}</span>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_360px]">
        <section aria-label="Interview" className="relative flex min-h-[520px] flex-col items-center justify-center gap-5 overflow-hidden rounded-[24px] bg-stage px-6 pt-10 pb-56 text-white">
          <div className="relative flex size-44 items-center justify-center">
            <span className={cx('absolute inset-0 rounded-full border-[3px] opacity-50 transition-colors', speaking ? 'animate-ping border-marigold [animation-duration:2s]' : 'border-white/15')} />
            <span className={cx('absolute inset-3 rounded-full border-[3px] transition-colors', speaking ? 'border-marigold' : 'border-white/15')} />
            <span className="flex size-32 items-center justify-center rounded-full bg-primary font-display text-[40px] font-extrabold">AI</span>
          </div>
          <LevelBars level={speaking ? 0.55 : paused || !media.micOn ? 0 : level} color={speaking ? 'bg-marigold' : 'bg-success'} bars={24} height={36} />
          <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
            <span className="font-display text-[20px] font-bold">{status[0]}</span>
            <span className="text-body-sm text-white/70">{status[1]}</span>
          </div>

          {media.stream && media.hasVideo && (
            <div className={cx('absolute top-5 right-5 aspect-[4/3] w-56 overflow-hidden rounded-2xl border-[3px] bg-white/10', speech.listening && !paused && media.micOn && level > 0.05 ? 'border-success' : 'border-transparent')}>
              {media.camOn ? <SelfView stream={media.stream} /> : <div className="flex size-full items-center justify-center text-body-sm text-white/70">Camera off</div>}
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-0.5 text-caption font-semibold">{!media.micOn && <MicOff className="size-3 text-rec" />}You</span>
            </div>
          )}

          {!media.stream && (
            <div className="absolute top-5 right-5 left-5 flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-body-sm">
              <span className="flex-1">Your microphone is off{prefs.mode === 'video' ? ' and the camera isn’t on' : ''}. Turn it back on to answer out loud{recordKind ? ' and keep recording' : ''}.</span>
              <Button variant="primary" icon={<Mic className="size-4" />} onClick={() => void media.request({ video: prefs.mode === 'video' })}>Turn on</Button>
            </div>
          )}

          <div className="absolute inset-x-5 bottom-5 flex flex-col gap-2 rounded-[20px] border border-white/15 bg-white/[0.07] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-marigold px-2.5 py-0.5 text-[12px] font-extrabold text-black">{question.kind === 'follow_up' ? 'Follow-up' : `Q${questionNumber}`}{question.topicLabel && ` · ${question.topicLabel}`}</span>
              <span className="text-caption text-white/70">Aim for about 2 minutes</span>
              <button type="button" onClick={() => void ask()} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/25 px-3 text-caption font-semibold hover:bg-white/10"><RotateCcw className="size-3.5" />Repeat question</button>
            </div>
            <p className="font-display text-[20px] leading-snug font-semibold">{question.content}</p>
          </div>
        </section>

        <aside aria-label="Your answer" className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[17px] font-bold">Your answer</h2>
              {speech.listening && <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-success"><span className="size-2 animate-pulse rounded-full bg-success" />Listening</span>}
            </div>
            <textarea aria-label="Your answer (live transcript, editable)" rows={8} value={answer + (speech.interim ? `${answer ? ' ' : ''}${speech.interim}` : '')} onChange={(e) => setAnswer(e.target.value)} onFocus={() => speech.interim && speech.stop()}
              placeholder={speech.supported ? 'Start speaking, your words appear here. You can fix anything before sending.' : 'Type your answer here.'}
              className="w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-body-sm leading-relaxed focus:border-primary focus:outline-none" />
            <div className="flex items-center justify-between text-caption text-muted"><span>{words} words</span>{question.rubricCriteria && <span className="truncate pl-3">Assessed on: {question.rubricCriteria.slice(0, 3).join(', ')}</span>}</div>
            {speech.error && <p className="text-caption text-vermillion">{speech.error}</p>}
            {sendError && <p className="text-caption text-vermillion">{sendError.message}</p>}
          </Card>
          {feedback}
          {history.length > 0 && (
            <Card className="flex max-h-72 flex-col gap-3 overflow-auto p-5">
              <h2 className="font-display text-[15px] font-bold">Transcript so far</h2>
              {history.map((m) => (
                <div key={m.id} className={cx('flex max-w-[92%] flex-col gap-1', m.speaker === 'candidate' && 'self-end items-end')}>
                  <span className="text-[11px] font-bold text-muted">{m.speaker === 'interviewer' ? 'Interviewer' : 'You'}</span>
                  <span className={cx('rounded-2xl px-3 py-2 text-body-sm', m.speaker === 'interviewer' ? 'rounded-tl-sm bg-primary-soft' : 'rounded-tr-sm bg-surface-2')}>{m.content}</span>
                </div>
              ))}
            </Card>
          )}
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pb-2">
        <RoundButton on={media.micOn} danger onClick={toggleMic} label={media.micOn ? 'Mute microphone' : 'Unmute microphone'}>{media.micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}</RoundButton>
        {media.hasVideo && <RoundButton on={media.camOn} danger onClick={() => media.setCam(!media.camOn)} label={media.camOn ? 'Turn camera off' : 'Turn camera on'}>{media.camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}</RoundButton>}
        <button type="button" onClick={togglePause} className="inline-flex h-14 items-center gap-2 rounded-full border border-line bg-surface px-5 text-body-sm font-semibold hover:border-primary/50">
          {paused ? <><Play className="size-4" />Resume</> : <><Pause className="size-4" />Pause</>}
        </button>
        <Button variant="primary" className="h-14 rounded-full px-7 text-body" icon={<Check className="size-5" />} loading={sending} disabled={answer.trim().length < 2 || paused} onClick={submit}>Done answering</Button>
        <button type="button" disabled={finishing} onClick={() => void end()} className="inline-flex h-14 items-center gap-2 rounded-full bg-rec px-6 text-body font-semibold text-white transition hover:brightness-110 disabled:opacity-60"><Flag className="size-5" />End &amp; review</button>
        <Button variant="text" className="h-14" onClick={() => window.confirm('Abandon this session? No report will be created.') && onAbandon()}>Abandon</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** Plays back the local recording with one timeline segment per question. Renders nothing if none exists. */
export function RecordingReplay({ sessionId }: { sessionId: number }) {
  const [rec, setRec] = useState<StoredRecording | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getRecording(sessionId).then((r) => { if (alive) setRec(r ?? null); });
    void load();
    const onSaved = (e: Event) => { if ((e as CustomEvent<number>).detail === sessionId) void load(); };
    window.addEventListener(RECORDING_SAVED_EVENT, onSaved);
    return () => { alive = false; window.removeEventListener(RECORDING_SAVED_EVENT, onSaved); };
  }, [sessionId]);
  useEffect(() => {
    if (!rec) { setUrl(null); return; }
    const u = URL.createObjectURL(rec.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec]);

  if (!rec || !url) return null;
  const duration = Math.max(1, rec.durationSec);
  const segments = rec.markers.map((m, i) => ({ ...m, end: rec.markers[i + 1]?.t ?? duration }));
  const active = segments.findIndex((s) => current >= s.t && current < s.end);
  const seek = (t: number) => { if (media.current) { media.current.currentTime = t; void media.current.play(); } };
  // MediaRecorder WebM files have no duration header; seeking to the end once makes the browser compute it.
  const fixDuration = () => {
    const el = media.current;
    if (!el || Number.isFinite(el.duration)) return;
    el.currentTime = 1e101;
    el.addEventListener('timeupdate', () => { el.currentTime = 0; }, { once: true });
  };
  const remove = async () => {
    if (!window.confirm('Delete this recording from this browser? The transcript and report stay.')) return;
    await deleteRecording(sessionId);
    setRec(null);
  };
  const ext = rec.mime.includes('mp4') ? 'mp4' : 'webm';

  return (
    <section aria-label="Recording" className="mb-8 overflow-hidden rounded-[24px] bg-stage text-white">
      {rec.kind === 'video'
        ? <video ref={media} src={url} controls playsInline onLoadedMetadata={fixDuration} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} className="aspect-video w-full bg-black" />
        : <div className="flex flex-col items-center gap-4 px-6 pt-10 pb-4">
            <LevelBars level={0.5} color="bg-marigold" bars={36} height={56} />
            <audio ref={media} src={url} controls onLoadedMetadata={fixDuration} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} className="w-full max-w-xl" />
          </div>}
      <div className="flex flex-col gap-3 px-5 pt-3 pb-5">
        {segments.length > 0 && (
          <div className="flex h-8 gap-1" aria-label="Jump to a question">
            {segments.map((s, i) => (
              <button key={i} type="button" onClick={() => seek(s.t)} title={s.label} style={{ flexGrow: Math.max(1, s.end - s.t) }}
                className={cx('min-w-8 truncate rounded-md px-1 text-[11px] font-bold transition-colors', i === active ? 'bg-marigold text-black' : 'bg-white/15 text-white hover:bg-white/25')}>
                {s.label.split(' · ')[0]}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-body-sm text-white/75">
          <span className="font-semibold text-white">Your recording</span>
          <span>{rec.kind === 'video' ? 'Video + audio' : 'Audio'} · {fmtTime(rec.durationSec)} · saved {new Date(rec.createdAt).toLocaleString()} · only in this browser</span>
          <span className="ml-auto flex gap-2">
            <a href={url} download={`interview-${sessionId}.${ext}`} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/25 px-3 font-semibold text-white hover:bg-white/10"><Download className="size-4" />Download</a>
            <button type="button" onClick={() => void remove()} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/25 px-3 font-semibold text-white hover:bg-white/10"><Trash2 className="size-4" />Delete</button>
          </span>
        </div>
      </div>
    </section>
  );
}
