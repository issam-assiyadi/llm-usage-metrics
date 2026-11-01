// The TUI's state and every change a key makes to it. Pure: the app hands each action the
// facts it needs about the current screen (`TuiEnv`) and gets a new state back. View changes
// go through the share report's own state functions, so a filter, period or sort means the
// same thing in the terminal and in the browser.

import type { ShareCostMode, ShareGranularity } from '../../share-report/types.js';
import type {
  ShareDimension,
  ShareReport,
  TableSortKey,
} from '../../share-report/client/core/index.js';
import type { FilterGroup, Option } from '../../share-report/client/ui/controls/model.js';
import {
  clearFilters,
  nextSort,
  resetView,
  toggleIndex,
  withFilter,
  withPeriod,
  withView,
  type PeriodPreset,
  type ShareUiState,
} from '../../share-report/client/ui/state/view.js';
import { clampCursor, type Cursor, type PaneShape } from '../charts/pane.js';

export type TabId = 'overview' | 'breakdown' | 'rates' | 'activity' | 'projects' | 'report';

export const TAB_IDS: readonly TabId[] = [
  'overview',
  'breakdown',
  'rates',
  'activity',
  'projects',
  'report',
];

export type PeriodField = 'from' | 'to';

export type Modal =
  | { kind: 'help' }
  | { kind: 'diagnostics'; scroll: number }
  | {
      kind: 'period';
      row: number;
      /** The custom range being typed, when the last row was picked. */
      editing?: { from: string; to: string; field: PeriodField; error?: string };
    }
  | { kind: 'filters'; group: number; row: number; query: string; searching: boolean };

export type TuiState = {
  ui: ShareUiState;
  tab: TabId;
  /** The pane with the keyboard, in the tab's pane list. */
  pane: number;
  /** Focus mode: the pane fills the screen with its notes and table. */
  focus: boolean;
  /** Each pane's cursor, by pane id; absent until the pane is first moved in. */
  cursors: Record<string, Cursor | undefined>;
  /** The selected row of the project or session table. */
  tableRow: number;
  /** The Report tab's first visible line. */
  reportScroll: number;
  modal: Modal | null;
  /** A one-line message in the status bar: an export path, a reload, a refusal. */
  status: string | undefined;
};

export function createTuiState(ui: ShareUiState, tab: TabId = 'overview'): TuiState {
  return {
    ui,
    tab,
    pane: 0,
    focus: false,
    cursors: {},
    tableRow: 0,
    reportScroll: 0,
    modal: null,
    status: undefined,
  };
}

/** What an action needs to know about the screen it acts on. */
export type TuiEnv = {
  report: ShareReport;
  /** Pane ids of the current tab, in order. */
  panes: readonly string[];
  /** The shape of the pane with the keyboard; undefined on a tab without panes. */
  paneShape: PaneShape | undefined;
  table: {
    rows: number;
    pageCount: number;
    /** The project index a row drills into. */
    drillOf: (row: number) => number | undefined;
    sortKeys: readonly TableSortKey[];
  };
  reportLines: number;
  /** Rows of the content area, for paging. */
  contentHeight: number;
  filterGroups: readonly FilterGroup[];
  presets: readonly PeriodPreset[];
  granularities: readonly Option<ShareGranularity>[];
  costModes: readonly Option<ShareCostMode>[];
  stacks: readonly Option<ShareDimension>[];
  diagnosticsLines: number;
};

export type TuiAction =
  | { type: 'tab'; tab: TabId }
  | { type: 'pane'; delta: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'page'; delta: number }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cycle'; field: 'granularity' | 'costMode' | 'stackBy' }
  | { type: 'hideNames' }
  | { type: 'resetView' }
  | { type: 'clearFilters' }
  | { type: 'sort'; reverse: boolean }
  | { type: 'open'; modal: 'help' | 'diagnostics' | 'period' | 'filters' }
  | { type: 'modalMove'; dx: number; dy: number }
  | { type: 'modalToggle' }
  | { type: 'modalAll' }
  | { type: 'modalSearch' }
  | { type: 'modalChar'; char: string }
  | { type: 'modalBackspace' }
  | { type: 'modalSubmit' }
  | { type: 'modalField' }
  | { type: 'status'; text: string | undefined };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function withUi(state: TuiState, ui: ShareUiState): TuiState {
  return ui === state.ui ? state : { ...state, ui, tableRow: 0, status: undefined };
}

/** The first move in a pane lands on its latest period (or first row); later moves step. */
function moveCursor(state: TuiState, env: TuiEnv, dx: number, dy: number): TuiState {
  const id = env.panes.at(state.pane);
  const shape = env.paneShape;

  if (id === undefined || shape === undefined || (shape.columns === 0 && shape.rows === 0)) {
    return state;
  }

  const current = state.cursors[id];
  const next =
    current === undefined
      ? { x: Math.max(0, shape.columns - 1), y: shape.startRow === 'last' ? shape.rows - 1 : 0 }
      : { x: current.x + dx, y: current.y + dy };

  return { ...state, cursors: { ...state.cursors, [id]: clampCursor(next, shape) ?? undefined } };
}

function cycleOption<Value extends string>(
  options: readonly Option<Value>[],
  current: Value | null,
): Value | undefined {
  const enabled = options.filter((option) => option.disabledReason === undefined);

  if (enabled.length === 0) {
    return undefined;
  }

  const at = enabled.findIndex((option) => option.value === current);
  return enabled[(at + 1) % enabled.length].value;
}

/** Options of the filter group on screen that match the search, as listed. */
export function visibleFilterOptions(
  modal: Extract<Modal, { kind: 'filters' }>,
  groups: readonly FilterGroup[],
) {
  const group = groups.at(modal.group);
  const query = modal.query.toLowerCase();

  return group === undefined
    ? []
    : group.options.filter((option) => option.label.toLowerCase().includes(query));
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;

function reduceModal(state: TuiState, action: TuiAction, env: TuiEnv): TuiState {
  const modal = state.modal;

  if (modal === null) {
    return state;
  }

  if (action.type === 'back') {
    if (modal.kind === 'filters' && modal.searching) {
      return { ...state, modal: { ...modal, searching: false, query: '' } };
    }

    if (modal.kind === 'period' && modal.editing) {
      return { ...state, modal: { kind: 'period', row: modal.row } };
    }

    return { ...state, modal: null };
  }

  switch (modal.kind) {
    case 'help':
      return state;
    case 'diagnostics':
      return action.type === 'modalMove'
        ? {
            ...state,
            modal: {
              kind: 'diagnostics',
              scroll: clamp(
                modal.scroll + action.dy,
                0,
                env.diagnosticsLines - env.contentHeight + 4,
              ),
            },
          }
        : state;
    case 'period':
      return reducePeriodModal(state, modal, action, env);
    case 'filters':
      return reduceFilterModal(state, modal, action, env);
  }
}

function reducePeriodModal(
  state: TuiState,
  modal: Extract<Modal, { kind: 'period' }>,
  action: TuiAction,
  env: TuiEnv,
): TuiState {
  const editing = modal.editing;

  if (editing) {
    switch (action.type) {
      case 'modalField':
        return {
          ...state,
          modal: {
            ...modal,
            editing: {
              ...editing,
              field: editing.field === 'from' ? 'to' : 'from',
              error: undefined,
            },
          },
        };
      case 'modalChar': {
        if (!/^[\d-]$/u.test(action.char) || editing[editing.field].length >= 10) {
          return state;
        }

        return {
          ...state,
          modal: {
            ...modal,
            editing: {
              ...editing,
              [editing.field]: editing[editing.field] + action.char,
              error: undefined,
            },
          },
        };
      }
      case 'modalBackspace':
        return {
          ...state,
          modal: {
            ...modal,
            editing: {
              ...editing,
              [editing.field]: editing[editing.field].slice(0, -1),
              error: undefined,
            },
          },
        };
      case 'modalSubmit': {
        if (!DATE_KEY.test(editing.from) || !DATE_KEY.test(editing.to)) {
          return {
            ...state,
            modal: { ...modal, editing: { ...editing, error: 'Dates are YYYY-MM-DD' } },
          };
        }

        const ui = withPeriod(state.ui, env.report, editing.from, editing.to);

        if (ui === state.ui) {
          return {
            ...state,
            modal: {
              ...modal,
              editing: {
                ...editing,
                error: 'The range must be inside the report and not inverted',
              },
            },
          };
        }

        return { ...withUi(state, ui), modal: null };
      }
      default:
        return state;
    }
  }

  const rows = env.presets.length + 1;

  switch (action.type) {
    case 'modalMove':
      return { ...state, modal: { ...modal, row: clamp(modal.row + action.dy, 0, rows - 1) } };
    case 'modalSubmit':
    case 'modalToggle': {
      const preset = env.presets.at(modal.row);

      if (preset === undefined) {
        return { ...state, modal: { ...modal, editing: initialRange(state, env) } };
      }

      return {
        ...withUi(state, withPeriod(state.ui, env.report, preset.since, preset.until)),
        modal: null,
      };
    }
    default:
      return state;
  }
}

function initialRange(
  state: TuiState,
  env: TuiEnv,
): NonNullable<Extract<Modal, { kind: 'period' }>['editing']> {
  const window = env.presets.at(-1);

  return {
    from: state.ui.view.since ?? window?.since ?? '',
    to: state.ui.view.until ?? window?.until ?? '',
    field: 'from',
  };
}

function reduceFilterModal(
  state: TuiState,
  modal: Extract<Modal, { kind: 'filters' }>,
  action: TuiAction,
  env: TuiEnv,
): TuiState {
  const group = env.filterGroups.at(modal.group);
  const options = visibleFilterOptions(modal, env.filterGroups);

  if (modal.searching) {
    switch (action.type) {
      case 'modalChar':
        return { ...state, modal: { ...modal, query: modal.query + action.char, row: 0 } };
      case 'modalBackspace':
        return { ...state, modal: { ...modal, query: modal.query.slice(0, -1), row: 0 } };
      case 'modalSubmit':
        return { ...state, modal: { ...modal, searching: false } };
      case 'modalMove':
        return {
          ...state,
          modal: { ...modal, row: clamp(modal.row + action.dy, 0, options.length - 1) },
        };
      default:
        return state;
    }
  }

  switch (action.type) {
    case 'modalMove':
      if (action.dx !== 0) {
        return {
          ...state,
          modal: {
            ...modal,
            group: clamp(modal.group + action.dx, 0, env.filterGroups.length - 1),
            row: 0,
            query: '',
          },
        };
      }

      return {
        ...state,
        modal: { ...modal, row: clamp(modal.row + action.dy, 0, options.length - 1) },
      };
    case 'modalSearch':
      return { ...state, modal: { ...modal, searching: true } };
    case 'modalToggle': {
      const option = options.at(modal.row);

      if (group === undefined || option === undefined) {
        return state;
      }

      const dimension = group.dimension;
      return {
        ...withUi(
          state,
          withFilter(state.ui, dimension, toggleIndex(state.ui.view[dimension], option.index)),
        ),
        modal,
      };
    }
    case 'modalAll':
      return group === undefined
        ? state
        : { ...withUi(state, withFilter(state.ui, group.dimension, [])), modal };
    case 'modalSubmit':
      return { ...state, modal: null };
    default:
      return state;
  }
}

function reduceSort(state: TuiState, env: TuiEnv, reverse: boolean): TuiState {
  const { sort } = state.ui.view;

  if (reverse) {
    return withUi(state, withView(state.ui, { sort: nextSort(sort, sort.key) }));
  }

  const keys = env.table.sortKeys;

  if (keys.length === 0) {
    return state;
  }

  const next = keys[(keys.indexOf(sort.key) + 1) % keys.length];
  return withUi(state, withView(state.ui, { sort: nextSort(sort, next) }));
}

export function reduceTui(state: TuiState, action: TuiAction, env: TuiEnv): TuiState {
  if (state.modal !== null && action.type !== 'status') {
    return reduceModal(state, action, env);
  }

  switch (action.type) {
    case 'status':
      return { ...state, status: action.text };
    case 'tab':
      return action.tab === state.tab
        ? state
        : { ...state, tab: action.tab, pane: 0, focus: false, status: undefined };
    case 'pane':
      return env.panes.length === 0
        ? state
        : { ...state, pane: (state.pane + action.delta + env.panes.length) % env.panes.length };
    case 'move':
      if (state.tab === 'projects') {
        return { ...state, tableRow: clamp(state.tableRow + action.dy, 0, env.table.rows - 1) };
      }

      if (state.tab === 'report') {
        return {
          ...state,
          reportScroll: clamp(
            state.reportScroll + action.dy,
            0,
            env.reportLines - env.contentHeight,
          ),
        };
      }

      return moveCursor(state, env, action.dx, action.dy);
    case 'page':
      if (state.tab === 'projects') {
        const page = clamp(state.ui.page + action.delta, 0, env.table.pageCount - 1);
        return page === state.ui.page
          ? state
          : { ...state, ui: { ...state.ui, page }, tableRow: 0 };
      }

      if (state.tab === 'report') {
        return {
          ...state,
          reportScroll: clamp(
            state.reportScroll + action.delta * Math.max(1, env.contentHeight - 2),
            0,
            env.reportLines - env.contentHeight,
          ),
        };
      }

      return state;
    case 'enter': {
      if (state.tab === 'projects') {
        const drill = env.table.drillOf(state.tableRow);
        return drill === undefined ? state : withUi(state, withView(state.ui, { drill }));
      }

      return env.panes.length === 0 ? state : { ...state, focus: !state.focus };
    }
    case 'back':
      if (state.focus) {
        return { ...state, focus: false };
      }

      if (state.tab === 'projects' && state.ui.view.drill !== null) {
        return withUi(state, withView(state.ui, { drill: null }));
      }

      return state;
    case 'cycle': {
      const { view } = state.ui;

      if (action.field === 'granularity') {
        const next = cycleOption(env.granularities, view.granularity);
        return next === undefined
          ? state
          : withUi(state, withView(state.ui, { granularity: next }));
      }

      if (action.field === 'costMode') {
        const next = cycleOption(env.costModes, view.costMode);
        return next === undefined
          ? { ...state, status: 'This report holds no cost to switch between' }
          : withUi(state, withView(state.ui, { costMode: next }));
      }

      const next = cycleOption(env.stacks, view.stackBy);
      return next === undefined ? state : withUi(state, withView(state.ui, { stackBy: next }));
    }
    case 'hideNames':
      return { ...state, ui: { ...state.ui, hideNames: !state.ui.hideNames } };
    case 'resetView':
      return {
        ...withUi(state, resetView(state.ui, env.report)),
        cursors: {},
        status: 'Back to the opening view',
      };
    case 'clearFilters':
      return withUi(state, clearFilters(state.ui));
    case 'sort':
      return state.tab === 'projects' ? reduceSort(state, env, action.reverse) : state;
    case 'open':
      switch (action.modal) {
        case 'help':
          return { ...state, modal: { kind: 'help' } };
        case 'diagnostics':
          return { ...state, modal: { kind: 'diagnostics', scroll: 0 } };
        case 'period':
          return { ...state, modal: { kind: 'period', row: 0 } };
        case 'filters':
          return env.filterGroups.length === 0
            ? { ...state, status: 'Every dimension has a single label: nothing to filter' }
            : {
                ...state,
                modal: { kind: 'filters', group: 0, row: 0, query: '', searching: false },
              };
      }
    // Falls through only for modal actions without a modal, which change nothing.
    default:
      return state;
  }
}
