import { describe, expect, it } from 'vitest';

import { getDefaultViewState, type ShareReport } from '../../src/share-report/client/core/index.js';
import { createMaskSource } from '../../src/share-report/client/ui/state/context.js';
import {
  countDimensionTokens,
  createScreenModel,
  renderLoadError,
  renderLoading,
  renderScreen,
} from '../../src/tui/screen.js';
import {
  createTuiState,
  TAB_IDS,
  type Modal,
  type TuiState,
} from '../../src/tui/state/tui-state.js';
import { linesText, lineWidth } from '../../src/tui/view/line.js';
import { loadFixtureReport } from './tui-fixture.js';

function screen(
  patch: Partial<TuiState> = {},
  size = { width: 120, height: 40 },
  report: ShareReport = loadFixtureReport(),
  mono = false,
): string {
  const state = {
    ...createTuiState({ view: getDefaultViewState(report), hideNames: false, page: 0 }),
    ...patch,
  };
  const model = createScreenModel(
    report,
    state,
    createMaskSource(report),
    countDimensionTokens(report),
    [
      { style: 'warn', text: 'pricing could not be loaded' },
      { style: 'info', text: 'Scanned 3 files' },
    ],
  );
  const lines = renderScreen(model, size, mono);

  if (size.width >= 80 && size.height >= 24) {
    expect(lines).toHaveLength(size.height);
    expect(lines.every((line) => lineWidth(line) === size.width)).toBe(true);
  }

  return linesText(lines);
}

describe('renderScreen', () => {
  it.each(TAB_IDS)('draws the %s tab at several sizes', (tab) => {
    expect(screen({ tab })).toContain('llm-usage');
    expect(screen({ tab }, { width: 80, height: 24 })).toContain('Overview');
    expect(screen({ tab }, { width: 200, height: 55 }, undefined, true)).toContain('Report');
  });

  it('shows the warnings badge, the key hints and focus mode', () => {
    const text = screen();

    expect(text).toContain('1 warning');
    expect(text).toContain('▐q▌ quit');
    expect(screen({ focus: true })).toContain('Esc back');
    expect(screen({ status: 'Reloaded' })).toContain('Reloaded');
    expect(
      screen({
        ui: {
          ...createTuiState({
            view: getDefaultViewState(loadFixtureReport()),
            hideNames: true,
            page: 0,
          }).ui,
        },
      }),
    ).toContain('Names hidden');
  });

  it.each<Modal>([
    { kind: 'help' },
    { kind: 'diagnostics', scroll: 0 },
    { kind: 'period', row: 1 },
    { kind: 'period', row: 4, editing: { from: '2026-01-01', to: '', field: 'to', error: 'bad' } },
    { kind: 'filters', group: 0, row: 0, query: 'c', searching: true },
  ])('draws the $kind dialog', (modal) => {
    expect(screen({ modal })).toMatch(/Keys|Messages|Period|Filters/u);
  });

  it('draws the empty state with its way out', () => {
    const report = loadFixtureReport();
    const state = createTuiState({
      view: { ...getDefaultViewState(report), source: [999] },
      hideNames: false,
      page: 0,
    });

    expect(screen(state, undefined, report)).toContain('Press x to clear the filters');
    const empty = loadFixtureReport((data) => {
      data.meta.window = { since: '2020-01-01', until: '2020-01-02' };
    });
    expect(screen({}, undefined, empty)).not.toBe('');
  });

  it('asks for a bigger terminal, and draws loading and error screens', () => {
    expect(screen({}, { width: 60, height: 20 })).toContain('needs 80×24');
    expect(linesText(renderLoading({ width: 100, height: 30 }, 3, 'Reading'))).toContain('Reading');
    expect(linesText(renderLoadError({ width: 100, height: 30 }, 'boom'))).toContain('boom');
  });
});
