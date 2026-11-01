import { describe, expect, it } from 'vitest';

import {
  getDefaultViewState,
  type ShareReport,
} from '../../../src/share-report/client/core/index.js';
import { createMaskSource } from '../../../src/share-report/client/ui/state/context.js';
import { buildEnv, countDimensionTokens, createScreenModel } from '../../../src/tui/screen.js';
import {
  createTuiState,
  reduceTui,
  visibleFilterOptions,
  type TuiAction,
  type TuiState,
} from '../../../src/tui/state/tui-state.js';
import { loadFixtureReport } from '../tui-fixture.js';

const SIZE = { width: 120, height: 40 };

function start(report: ShareReport = loadFixtureReport()): {
  report: ShareReport;
  state: TuiState;
} {
  return {
    report,
    state: createTuiState({ view: getDefaultViewState(report), hideNames: false, page: 0 }),
  };
}

function run(report: ShareReport, state: TuiState, ...actions: TuiAction[]): TuiState {
  const mask = createMaskSource(report);
  const tokens = countDimensionTokens(report);

  return actions.reduce((current, action) => {
    const env = buildEnv(createScreenModel(report, current, mask, tokens, []), SIZE, false);
    return reduceTui(current, action, env);
  }, state);
}

describe('reduceTui', () => {
  it('switches tabs and panes, and moves a pane cursor from its latest period', () => {
    const { report, state } = start();
    const moved = run(report, state, { type: 'move', dx: 1, dy: 0 });
    const cursor = moved.cursors['cost-over-time'];

    expect(cursor?.x).toBeGreaterThan(0);
    expect(run(report, moved, { type: 'move', dx: -1, dy: 0 }).cursors['cost-over-time']?.x).toBe(
      (cursor?.x ?? 0) - 1,
    );
    expect(run(report, state, { type: 'pane', delta: 1 }).pane).toBe(1);
    expect(run(report, state, { type: 'pane', delta: -1 }).pane).toBe(1);
    expect(run(report, state, { type: 'tab', tab: 'rates' }).tab).toBe('rates');
    expect(run(report, state, { type: 'tab', tab: 'overview' })).toBe(state);
  });

  it('enters and leaves focus mode', () => {
    const { report, state } = start();
    const focused = run(report, state, { type: 'enter' });

    expect(focused.focus).toBe(true);
    expect(run(report, focused, { type: 'back' }).focus).toBe(false);
    expect(run(report, state, { type: 'back' })).toBe(state);
  });

  it('cycles granularity, cost mode and stacking through the share report options', () => {
    const { report, state } = start();

    expect(
      run(report, state, { type: 'cycle', field: 'granularity' }).ui.view.granularity,
    ).not.toBe(state.ui.view.granularity);
    expect(run(report, state, { type: 'cycle', field: 'stackBy' }).ui.view.stackBy).toBe('model');
    expect(
      run(report, state, { type: 'cycle', field: 'costMode' }).ui.view.costMode,
    ).not.toBeNull();

    const noCost = loadFixtureReport((data) => {
      data.meta.costMode = null;
      data.cube.costs = {};
    });
    expect(run(noCost, start(noCost).state, { type: 'cycle', field: 'costMode' }).status).toContain(
      'no cost',
    );
  });

  it('hides names, resets the view and clears filters', () => {
    const { report, state } = start();
    const filtered = {
      ...state,
      ui: { ...state.ui, view: { ...state.ui.view, source: [0], granularity: 'month' as const } },
    };

    expect(run(report, state, { type: 'hideNames' }).ui.hideNames).toBe(true);
    expect(run(report, filtered, { type: 'clearFilters' }).ui.view.source).toEqual([]);
    const reset = run(report, filtered, { type: 'resetView' });
    expect(reset.ui.view.granularity).toBe(getDefaultViewState(report).granularity);
    expect(reset.status).toContain('opening view');
    expect(run(report, state, { type: 'status', text: 'hi' }).status).toBe('hi');
  });

  it('selects, sorts, pages and drills in the project table', () => {
    const { report, state } = start();
    const projects = run(report, state, { type: 'tab', tab: 'projects' });
    const down = run(report, projects, { type: 'move', dx: 0, dy: 1 });

    expect(down.tableRow).toBe(1);
    expect(run(report, projects, { type: 'sort', reverse: true }).ui.view.sort.direction).toBe(
      'asc',
    );
    expect(run(report, projects, { type: 'sort', reverse: false }).ui.view.sort.key).not.toBe(
      projects.ui.view.sort.key,
    );
    expect(run(report, projects, { type: 'page', delta: 1 }).ui.page).toBe(0);

    const drilled = run(report, projects, { type: 'enter' });
    expect(drilled.ui.view.drill).not.toBeNull();
    expect(run(report, drilled, { type: 'back' }).ui.view.drill).toBeNull();
    expect(run(report, state, { type: 'sort', reverse: false })).toBe(state);
  });

  it('scrolls the report tab', () => {
    const { report, state } = start();
    const tab = run(report, state, { type: 'tab', tab: 'report' });

    expect(run(report, tab, { type: 'move', dx: 0, dy: 1 }).reportScroll).toBe(0);
    expect(run(report, tab, { type: 'page', delta: 1 }).reportScroll).toBe(0);
    expect(run(report, tab, { type: 'enter' })).toBe(tab);
  });

  it('picks a period preset or a typed range, refusing a bad one', () => {
    const { report, state } = start();
    const open = run(report, state, { type: 'open', modal: 'period' });

    expect(open.modal?.kind).toBe('period');
    const preset = run(report, open, { type: 'modalMove', dx: 0, dy: 1 }, { type: 'modalSubmit' });
    expect(preset.modal).toBeNull();
    expect(preset.ui.view.since).not.toBe(state.ui.view.since);

    let custom = run(report, open, { type: 'modalMove', dx: 0, dy: 99 }, { type: 'modalSubmit' });
    expect(custom.modal).toMatchObject({ kind: 'period', editing: { field: 'from' } });
    custom = run(
      report,
      custom,
      { type: 'modalBackspace' },
      { type: 'modalChar', char: 'x' },
      { type: 'modalSubmit' },
    );
    expect(custom.modal).toMatchObject({ editing: { error: 'Dates are YYYY-MM-DD' } });
    custom = run(
      report,
      custom,
      { type: 'modalChar', char: '1' },
      { type: 'modalField' },
      { type: 'modalBackspace' },
    );
    expect(custom.modal).toMatchObject({ editing: { field: 'to' } });

    const window = report.data.meta.window;
    const inverted = run(
      report,
      open,
      { type: 'modalMove', dx: 0, dy: 99 },
      { type: 'modalSubmit' },
    );
    const typed = (value: string): TuiAction[] =>
      Array.from({ length: value.length }, (_, index) => ({
        type: 'modalChar',
        char: value.charAt(index),
      }));
    const clear: TuiAction[] = Array.from({ length: 10 }, () => ({ type: 'modalBackspace' }));
    const bad = run(report, inverted, ...clear, ...typed('1999-01-01'), { type: 'modalSubmit' });
    expect(bad.modal?.kind === 'period' ? bad.modal.editing?.error : '').toContain(
      'inside the report',
    );
    const good = run(report, inverted, ...clear, ...typed(window.since ?? '2026-01-01'), {
      type: 'modalSubmit',
    });
    expect(good.modal).toBeNull();
    expect(run(report, custom, { type: 'back' }).modal).toMatchObject({ kind: 'period' });
  });

  it('toggles, searches and clears filters in the filter dialog', () => {
    const { report, state } = start();
    const open = run(report, state, { type: 'open', modal: 'filters' });

    expect(open.modal?.kind).toBe('filters');
    const toggled = run(report, open, { type: 'modalToggle' });
    expect(toggled.ui.view.source.length + toggled.ui.view.model.length).toBe(1);
    expect(run(report, toggled, { type: 'modalAll' }).ui.view.source).toEqual([]);

    const next = run(
      report,
      open,
      { type: 'modalMove', dx: 1, dy: 0 },
      { type: 'modalMove', dx: 0, dy: 1 },
    );
    expect(next.modal).toMatchObject({ group: 1, row: 1 });

    const searching = run(
      report,
      open,
      { type: 'modalSearch' },
      { type: 'modalChar', char: 'z' },
      { type: 'modalChar', char: 'q' },
    );
    expect(searching.modal).toMatchObject({ searching: true, query: 'zq' });
    const groups = buildEnv(
      createScreenModel(
        report,
        searching,
        createMaskSource(report),
        countDimensionTokens(report),
        [],
      ),
      SIZE,
      false,
    ).filterGroups;
    expect(
      searching.modal?.kind === 'filters' && visibleFilterOptions(searching.modal, groups),
    ).toEqual([]);
    expect(run(report, searching, { type: 'modalBackspace' }).modal).toMatchObject({ query: 'z' });
    expect(run(report, searching, { type: 'modalMove', dx: 0, dy: 1 }).modal).toMatchObject({
      row: 0,
    });
    expect(run(report, searching, { type: 'modalSubmit' }).modal).toMatchObject({
      searching: false,
    });
    expect(run(report, searching, { type: 'back' }).modal).toMatchObject({
      searching: false,
      query: '',
    });
    expect(run(report, open, { type: 'modalSubmit' }).modal).toBeNull();
    expect(run(report, open, { type: 'modalField' })).toBe(open);
  });

  it('opens help and the messages drawer, and closes them', () => {
    const { report, state } = start();
    const help = run(report, state, { type: 'open', modal: 'help' });

    expect(run(report, help, { type: 'modalToggle' })).toBe(help);
    expect(run(report, help, { type: 'back' }).modal).toBeNull();
    const drawer = run(report, state, { type: 'open', modal: 'diagnostics' });
    expect(run(report, drawer, { type: 'modalMove', dx: 0, dy: 3 }).modal).toEqual({
      kind: 'diagnostics',
      scroll: 0,
    });
    expect(run(report, drawer, { type: 'modalToggle' })).toBe(drawer);
  });
});
