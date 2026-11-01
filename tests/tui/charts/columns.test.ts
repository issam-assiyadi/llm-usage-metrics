import { describe, expect, it } from 'vitest';

import {
  placeColumns,
  placeLabels,
  renderColumnChart,
  seriesPattern,
  visibleStart,
  type ColumnChartInput,
} from '../../../src/tui/charts/columns.js';
import { lineText, linesText, lineWidth } from '../../../src/tui/view/line.js';

const series = [
  { label: 'a', tone: 'series-0' as const, other: false },
  { label: 'b', tone: 'series-1' as const, other: false },
];

function input(overrides: Partial<ColumnChartInput> = {}): ColumnChartInput {
  return {
    series,
    slots: [
      { short: 'Mon', values: [4, 4] },
      { short: 'Tue', values: [2, 0] },
      { short: 'Wed', values: [null, null] },
    ],
    width: 20,
    height: 4,
    cursor: null,
    mono: false,
    tickFormat: () => (value) => String(value),
    ...overrides,
  };
}

describe('placeColumns', () => {
  it('spreads equal bars with gaps when there is room', () => {
    expect(placeColumns(12, 3)).toEqual([
      { x: 1, width: 3 },
      { x: 5, width: 3 },
      { x: 9, width: 3 },
    ]);
  });

  it('centres touching one-column bars when there is no room for gaps', () => {
    const placements = placeColumns(5, 3);

    expect(placements.map((entry) => entry.width)).toEqual([1, 1, 1]);
    expect(placements.map((entry) => entry.x)).toEqual([1, 2, 3]);
  });

  it('caps bar width and gives one column each past the width', () => {
    expect(placeColumns(100, 2).every((entry) => entry.width === 8)).toBe(true);
    expect(placeColumns(3, 10)).toHaveLength(3);
    expect(placeColumns(3, 0)).toEqual([]);
  });
});

describe('visibleStart', () => {
  it('shows the latest periods, or centres the cursor', () => {
    expect(visibleStart(10, 4, null)).toBe(6);
    expect(visibleStart(10, 4, 5)).toBe(3);
    expect(visibleStart(10, 4, 0)).toBe(0);
    expect(visibleStart(10, 4, 9)).toBe(6);
  });
});

describe('placeLabels', () => {
  it('centres labels under bars and drops the ones that would collide', () => {
    const placements = placeColumns(12, 3);

    expect(placeLabels(['a', 'b', 'c'], placements, 12, null)).toBe('  a   b   c ');
    expect(placeLabels(['long', 'long', 'x'], placeColumns(6, 3), 6, null).trim()).toBe('long');
  });

  it('always places the selected label', () => {
    expect(placeLabels(['long', 'next'], placeColumns(6, 2), 6, 1).trim()).toBe('next');
  });
});

describe('renderColumnChart', () => {
  it('draws stacked columns with eighth blocks, ticks, labels and a marker row', () => {
    const chart = renderColumnChart(input());

    expect(chart.start).toBe(0);
    expect(chart.end).toBe(3);
    // Bars, a baseline, labels and the cursor row.
    expect(chart.lines).toHaveLength(7);
    expect(chart.lines.every((line) => lineWidth(line) <= 20)).toBe(true);
    expect(linesText(chart.lines)).toContain('Mon');
    expect(lineText(chart.lines[0])).toContain('10 ┤');
  });

  it('splits a cell where one series ends and the next starts', () => {
    const chart = renderColumnChart(
      input({ slots: [{ short: 'x', values: [3, 5] }], height: 2, width: 12 }),
    );
    const split = chart.lines
      .flat()
      .find((segment) => segment.style?.fg === 'series-0' && segment.style.bg === 'series-1');

    expect(['▁', '▂', '▃', '▄', '▅', '▆', '▇']).toContain(split?.text.trim().charAt(0));
  });

  it('draws series as patterns without colour, and the cursor bold with its marker', () => {
    const chart = renderColumnChart(input({ mono: true, cursor: 1 }));
    const text = linesText(chart.lines);

    expect(text).toContain('▓');
    expect(
      chart.lines
        .flat()
        .some((segment) => segment.style?.fg !== undefined && segment.text.includes('█')),
    ).toBe(false);
    expect(lineText(chart.lines[chart.lines.length - 1])).toContain('▲');
    expect(seriesPattern({ label: 'Other', tone: 'series-other', other: true }, 0)).toBe('·');
  });

  it('scrolls to the cursor with marks for the periods off screen', () => {
    const slots = Array.from({ length: 30 }, (_, index) => ({
      short: String(index),
      values: [index, 0],
    }));
    const chart = renderColumnChart(input({ slots, width: 14, cursor: 10 }));
    const marker = lineText(chart.lines[chart.lines.length - 1]);

    expect(chart.start).toBeGreaterThan(0);
    expect(chart.end).toBeLessThan(30);
    expect(marker.startsWith('◀')).toBe(true);
    expect(marker.endsWith('▶')).toBe(true);
  });

  it('draws a reference line across and honours a fixed maximum', () => {
    const chart = renderColumnChart(
      input({
        slots: [{ short: 'x', values: [0.2] }],
        series: [series[0]],
        reference: 0.5,
        max: 1,
      }),
    );

    expect(linesText(chart.lines)).toContain('╌');
    expect(lineText(chart.lines[0])).toContain('1 ┤');
  });
});
