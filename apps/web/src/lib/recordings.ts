/**
 * Interview recordings live only in this browser (IndexedDB). They are never uploaded:
 * the API receives the transcript text, exactly as with typed answers.
 */
export interface RecordingMarker { t: number; label: string }
export interface StoredRecording {
  sessionId: number;
  blob: Blob;
  mime: string;
  kind: 'video' | 'audio';
  markers: RecordingMarker[];
  durationSec: number;
  createdAt: string;
}

const DB = 'careerpilot-recordings';
const STORE = 'recordings';
export const RECORDING_SAVED_EVENT = 'cp-recording-saved';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'sessionId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveRecording(r: StoredRecording) {
  await run('readwrite', (s) => s.put(r));
  window.dispatchEvent(new CustomEvent(RECORDING_SAVED_EVENT, { detail: r.sessionId }));
}
export const getRecording = (sessionId: number) => run<StoredRecording | undefined>('readonly', (s) => s.get(sessionId)).catch(() => undefined);
export const deleteRecording = (sessionId: number) => run('readwrite', (s) => s.delete(sessionId));
