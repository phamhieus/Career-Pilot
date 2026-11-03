import { Mic, MicOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx, Textarea } from './ui';

export interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
}
type Ctor = new () => SpeechRecognitionLike;
export const getCtor = (): Ctor | undefined => (window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition;

/**
 * Answer box supporting typing, OS-level dictation (e.g. Wispr Flow types into the focused field)
 * and the browser Web Speech API when available. Audio is never uploaded or stored by CareerPilot;
 * only the resulting text is submitted. `onModeChange` reports whether voice was used.
 */
export function VoiceTextarea({ value, onChange, language = 'en', rows = 6, placeholder, onModeChange, disabled }: { value: string; onChange: (v: string) => void; language?: string; rows?: number; placeholder?: string; onModeChange?: (m: 'text' | 'voice') => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const base = useRef('');
  const supported = typeof window !== 'undefined' && !!getCtor();

  useEffect(() => () => rec.current?.stop(), []);
  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const C = getCtor();
    if (!C) return;
    const r = new C();
    r.lang = language === 'vi' ? 'vi-VN' : 'en-US';
    r.continuous = true;
    r.interimResults = true;
    base.current = value ? `${value.trim()} ` : '';
    r.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (finalText += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
      onChange(`${base.current}${finalText}${interim}`);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Speech recognition error: ${e.error}`);
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
    onModeChange?.('voice');
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea rows={rows} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label="Your answer" />
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted">
        {supported ? (
          <button type="button" onClick={toggle} disabled={disabled} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors', listening ? 'bg-coral text-white' : 'bg-black/[0.05] text-ink hover:bg-black/10 dark:bg-white/10')}>
            {listening ? <><MicOff className="size-3.5" />Stop dictation</> : <><Mic className="size-3.5" />Dictate (browser speech)</>}
          </button>
        ) : <span>Browser speech input isn’t available here.</span>}
        <span>Using Wispr Flow or OS dictation? Just dictate into the box — it works like typing.</span>
        {listening && <span className="text-coral">● listening — transcript only, no audio is stored</span>}
      </div>
      {error && <span className="text-caption text-vermillion">{error}</span>}
    </div>
  );
}
