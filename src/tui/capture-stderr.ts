// While Ink owns the screen, the logger and raw stderr writes go to the warnings drawer instead
// of tearing the frame. Runs in the CLI bundle, around the TUI, so it captures the logger the
// data pipeline actually logs through.

import { setLogSink } from '../utils/logger.js';
import type { DiagnosticsStore } from './diagnostics.js';

/**
 * Routes the logger and raw stderr into `store` until the returned function restores them.
 * Ink writes only to stdout, so nothing it draws passes through here.
 */
export function captureStderr(store: DiagnosticsStore): () => void {
  const previousSink = setLogSink((style, message) => {
    store.add(style, message);
  });
  const originalWrite = process.stderr.write.bind(process.stderr);
  const capture = (chunk: string | Uint8Array): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

    for (const line of text.split('\n')) {
      store.add('stderr', line);
    }

    return true;
  };
  process.stderr.write = capture;

  return () => {
    process.stderr.write = originalWrite;
    setLogSink(previousSink);
  };
}

/** What would have gone to stderr, printed once the TUI has given the screen back. */
export function replayWarnings(store: DiagnosticsStore, write: (text: string) => void): void {
  for (const message of store.list()) {
    if (message.style === 'warn' || message.style === 'stderr') {
      write(`⚠ ${message.text}\n`);
    }
  }
}
