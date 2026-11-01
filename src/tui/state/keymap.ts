// Keys to actions, in one table: the handler reads it, and so do the footer hints and the
// help screen, so a key never does something its description does not say.

import type { Modal, TabId, TuiAction } from './tui-state.js';
import { TAB_IDS } from './tui-state.js';

/** The parts of Ink's key event the TUI reads. */
export type KeyInfo = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  backspace?: boolean;
  delete?: boolean;
};

/** Effects the app runs itself: they reach past the state. */
export type TuiEffect = 'quit' | 'reload' | 'export';

export type KeyResult = { action: TuiAction } | { effect: TuiEffect } | undefined;

/** A key's help line; `footer` is its short label in the bottom border. */
export type KeyHelp = { keys: string; what: string; footer?: string };

export const KEY_HELP: readonly KeyHelp[] = [
  { keys: '1-6', what: 'Switch tab (Overview, Breakdown, Rates, Activity, Projects, Report)' },
  { keys: 'Tab / Shift+Tab', what: 'Next or previous pane in the tab', footer: 'Tab pane' },
  {
    keys: '←/→ ↑/↓',
    what: 'Read a period, cell or row; scroll tables and the report',
    footer: '←→↑↓ read',
  },
  {
    keys: 'Enter',
    what: 'Focus the pane full screen (or open a project’s sessions)',
    footer: 'Enter focus',
  },
  { keys: 'Esc', what: 'Leave focus, a dialog or the sessions' },
  { keys: 'f', what: 'Filter sources, models, projects and machines', footer: 'f filter' },
  { keys: 'p', what: 'Pick the period: presets or a custom range', footer: 'p period' },
  { keys: 'g', what: 'Cycle granularity: hour, day, week, month', footer: 'g granularity' },
  { keys: 'c', what: 'Cycle the cost mode: explicit, estimated, both', footer: 'c cost' },
  {
    keys: 's',
    what: 'Cycle what the charts stack by: source, model, project, machine',
    footer: 's stack',
  },
  { keys: 'h', what: 'Hide project and machine names on screen' },
  { keys: 'r / x', what: 'Reset to the opening view / clear the filters' },
  { keys: 'o / O', what: 'Projects tab: sort by the next column / reverse the sort' },
  { keys: 'PgUp/PgDn', what: 'Projects tab: previous or next page; Report tab: scroll a screen' },
  { keys: 'R', what: 'Reload: read your sessions again, keeping the view' },
  { keys: 'e', what: 'Export this view as the interactive HTML report and open it' },
  { keys: 'd', what: 'Show the warnings collected while reading' },
  { keys: '?', what: 'This help', footer: '? help' },
  { keys: 'q', what: 'Quit', footer: 'q quit' },
];

function arrows(key: KeyInfo): { dx: number; dy: number } | undefined {
  if (key.leftArrow) return { dx: -1, dy: 0 };
  if (key.rightArrow) return { dx: 1, dy: 0 };
  if (key.upArrow) return { dx: 0, dy: -1 };
  if (key.downArrow) return { dx: 0, dy: 1 };
  return undefined;
}

function mapModalKey(input: string, key: KeyInfo, modal: Modal): KeyResult {
  const move = arrows(key);

  if (key.escape) {
    return { action: { type: 'back' } };
  }

  if (move) {
    return { action: { type: 'modalMove', ...move } };
  }

  if (key.return) {
    return { action: { type: 'modalSubmit' } };
  }

  if (key.backspace || key.delete) {
    return { action: { type: 'modalBackspace' } };
  }

  const typing =
    (modal.kind === 'filters' && modal.searching) ||
    (modal.kind === 'period' && modal.editing !== undefined);

  if (modal.kind === 'period' && modal.editing !== undefined && key.tab) {
    return { action: { type: 'modalField' } };
  }

  if (typing) {
    return input.length === 1 && !key.ctrl
      ? { action: { type: 'modalChar', char: input } }
      : undefined;
  }

  if (input === 'q' || input === '?') {
    return { action: { type: 'back' } };
  }

  if (modal.kind === 'filters') {
    if (input === ' ') return { action: { type: 'modalToggle' } };
    if (input === 'a') return { action: { type: 'modalAll' } };
    if (input === '/') return { action: { type: 'modalSearch' } };
  }

  if (modal.kind === 'diagnostics' && (key.pageDown || key.pageUp)) {
    return { action: { type: 'modalMove', dx: 0, dy: key.pageDown ? 10 : -10 } };
  }

  return undefined;
}

const SIMPLE_KEYS: Record<string, KeyResult> = {
  q: { effect: 'quit' },
  R: { effect: 'reload' },
  e: { effect: 'export' },
  f: { action: { type: 'open', modal: 'filters' } },
  p: { action: { type: 'open', modal: 'period' } },
  d: { action: { type: 'open', modal: 'diagnostics' } },
  '?': { action: { type: 'open', modal: 'help' } },
  g: { action: { type: 'cycle', field: 'granularity' } },
  c: { action: { type: 'cycle', field: 'costMode' } },
  s: { action: { type: 'cycle', field: 'stackBy' } },
  h: { action: { type: 'hideNames' } },
  r: { action: { type: 'resetView' } },
  x: { action: { type: 'clearFilters' } },
  o: { action: { type: 'sort', reverse: false } },
  O: { action: { type: 'sort', reverse: true } },
};

export function mapKey(input: string, key: KeyInfo, modal: Modal | null): KeyResult {
  if (key.ctrl && input === 'c') {
    return { effect: 'quit' };
  }

  if (modal !== null) {
    return mapModalKey(input, key, modal);
  }

  const move = arrows(key);

  if (move) {
    return { action: { type: 'move', ...move } };
  }

  if (key.tab) {
    return { action: { type: 'pane', delta: key.shift ? -1 : 1 } };
  }

  if (key.pageDown || key.pageUp) {
    return { action: { type: 'page', delta: key.pageDown ? 1 : -1 } };
  }

  if (key.return) {
    return { action: { type: 'enter' } };
  }

  if (key.escape) {
    return { action: { type: 'back' } };
  }

  const tabIndex = Number(input) - 1;

  if (/^[1-6]$/u.test(input)) {
    const tab: TabId | undefined = TAB_IDS.at(tabIndex);
    return tab === undefined ? undefined : { action: { type: 'tab', tab } };
  }

  return SIMPLE_KEYS[input];
}
