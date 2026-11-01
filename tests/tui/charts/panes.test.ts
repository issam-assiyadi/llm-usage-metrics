import { describe, expect, it } from 'vitest';

import {
  MODEL_MIX_PANE,
  PROJECTS_PANE,
  horizontalBar,
} from '../../../src/tui/charts/breakdown-panes.js';
import { BLOCKS_PANE, HOUR_WEEKDAY_PANE } from '../../../src/tui/charts/heat-panes.js';
import {
  clampCursor,
  focusDetail,
  legendLines,
  type PaneInput,
  type TuiPane,
} from '../../../src/tui/charts/pane.js';
import {
  CACHE_HIT_PANE,
  COST_OVER_TIME_PANE,
  COST_PER_HOUR_PANE,
  TOKENS_OVER_TIME_PANE,
} from '../../../src/tui/charts/time-panes.js';
import { lineWidth, linesText } from '../../../src/tui/view/line.js';
import { fixtureContext, loadFixtureReport } from '../tui-fixture.js';

const PANES: readonly TuiPane[] = [
  COST_OVER_TIME_PANE,
  TOKENS_OVER_TIME_PANE,
  PROJECTS_PANE,
  MODEL_MIX_PANE,
  CACHE_HIT_PANE,
  COST_PER_HOUR_PANE,
  HOUR_WEEKDAY_PANE,
  BLOCKS_PANE,
];

function render(pane: TuiPane, overrides: Partial<PaneInput> = {}): string {
  const context = overrides.context ?? fixtureContext();
  const lines = pane.render({
    context,
    width: 90,
    height: 24,
    cursor: null,
    mono: false,
    focus: false,
    ...overrides,
  });

  expect(lines.every((line) => lineWidth(line) <= 90)).toBe(true);
  return linesText(lines);
}

describe('chart panes', () => {
  it.each(PANES.map((pane) => [pane.id, pane] as const))(
    '%s draws without a cursor, with one, in focus and in mono',
    (_id, pane) => {
      const context = fixtureContext();
      const shape = pane.shape(context, false);
      const cursor = clampCursor({ x: shape.columns - 1, y: shape.rows - 1 }, shape);

      expect(render(pane)).not.toBe('');
      expect(render(pane, { cursor })).not.toBe('');
      expect(render(pane, { cursor, focus: true, height: 40 })).not.toBe('');
      expect(render(pane, { cursor, mono: true })).not.toBe('');
    },
  );

  it('reads a period under the cursor in the over-time charts', () => {
    const context = fixtureContext();
    const shape = COST_OVER_TIME_PANE.shape(context, false);
    const text = render(COST_OVER_TIME_PANE, { cursor: { x: shape.columns - 1, y: 0 } });

    expect(text).toContain('▲ ');
    expect(COST_OVER_TIME_PANE.shape(context, true).rows).toBeGreaterThan(0);
  });

  it('says why there is nothing to draw', () => {
    const noCost = fixtureContext(undefined, { costMode: null });
    const empty = fixtureContext(undefined, { source: [999] });

    expect(render(COST_OVER_TIME_PANE, { context: noCost })).toContain('no cost');
    expect(render(COST_PER_HOUR_PANE, { context: noCost })).toContain('no cost');
    expect(render(PROJECTS_PANE, { context: empty })).toMatch(/No (priced usage|tokens)/u);
    expect(render(MODEL_MIX_PANE, { context: empty })).toContain('No tokens');
    expect(render(HOUR_WEEKDAY_PANE, { context: empty })).toContain('No hourly usage');
    expect(render(BLOCKS_PANE, { context: empty })).not.toBe('');
    expect(render(CACHE_HIT_PANE, { context: empty })).toContain('Nothing to measure');
  });

  it('ranks projects by tokens without a priced cost mode', () => {
    const report = loadFixtureReport((data) => {
      data.meta.costMode = null;
      data.cube.costs = {};
    });
    const text = render(PROJECTS_PANE, { context: fixtureContext(report) });

    expect(text).toContain('By tokens');
  });

  it('reads a ranked row and a heat cell', () => {
    expect(render(PROJECTS_PANE, { cursor: { x: 0, y: 0 } })).toContain('▸ ');
    expect(render(MODEL_MIX_PANE, { cursor: { x: 0, y: 0 } })).toContain('▸ ');
    expect(render(HOUR_WEEKDAY_PANE, { cursor: { x: 9, y: 1 } })).toContain('◆ Tue 09:00');
    const shape = BLOCKS_PANE.shape(fixtureContext(), false);
    expect(shape.startRow).toBe('last');
    expect(render(BLOCKS_PANE, { cursor: { x: 0, y: shape.rows - 1 } })).toContain('◆ ');
  });
});

describe('pane helpers', () => {
  it('draws horizontal bars in eighths, never empty for a share above zero', () => {
    expect(horizontalBar(1, 4)).toBe('████');
    expect(horizontalBar(0.5, 3)).toBe('█▌');
    expect(horizontalBar(0.0001, 4)).toBe('▏');
    expect(horizontalBar(0, 4)).toBe('');
  });

  it('wraps a legend and pages a focus table', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      label: `series ${index}`,
      value: '1',
      tone: 'series-0' as const,
      glyph: '█',
    }));

    expect(legendLines(items, 30, false).length).toBeGreaterThan(1);
    const table = {
      caption: 'Rows',
      columns: [
        { label: 'A', numeric: false },
        { label: 'B', numeric: true },
      ],
      rows: Array.from({ length: 20 }, (_, index) => [`r${index}`, String(index)]),
      total: ['All', '190'],
    };
    const detail = linesText(focusDetail(['a note'], table, 40, 10, 5));

    expect(detail).toContain('a note');
    expect(detail).toContain('rows 6–');
    expect(clampCursor(null, { columns: 1, rows: 1 })).toBeNull();
    expect(clampCursor({ x: 5, y: -1 }, { columns: 3, rows: 0 })).toEqual({ x: 2, y: 0 });
  });
});

describe('16-colour heatmaps', () => {
  it('draw heat levels as glyphs as well as tones', () => {
    const text = render(HOUR_WEEKDAY_PANE, { basicColor: true, height: 30 });

    expect(text).toMatch(/[░▒▓]/u);
  });
});
