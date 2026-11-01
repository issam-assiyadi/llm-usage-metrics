// Messages the CLI would print on stderr while the TUI owns the screen: collected here for the
// warnings drawer, and printed after the TUI exits so nothing is lost.

import { stripVTControlCharacters } from 'node:util';

import type { LogStyle } from '../utils/logger.js';

export type CollectedMessage = { style: LogStyle | 'stderr'; text: string };

/** The text without the colour and cursor codes a raw stderr write may carry. */
export function stripAnsiCodes(text: string): string {
  return stripVTControlCharacters(text);
}

export class DiagnosticsStore {
  private readonly messages: CollectedMessage[] = [];
  private readonly listeners = new Set<() => void>();

  add(style: CollectedMessage['style'], text: string): void {
    const clean = stripAnsiCodes(text).trim();

    if (clean === '') {
      return;
    }

    this.messages.push({ style, text: clean });

    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Every message so far, oldest first. */
  list(): readonly CollectedMessage[] {
    return this.messages;
  }

  /** Warnings and raw stderr lines: what the badge counts. */
  warningCount(): number {
    return this.messages.filter((message) => message.style === 'warn' || message.style === 'stderr')
      .length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
