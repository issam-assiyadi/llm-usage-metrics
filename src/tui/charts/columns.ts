// A column chart drawn in terminal cells: one column per period, stacked series from the
// bottom, a y axis with round ticks and thinned period labels under it.
//
// Clarity at terminal resolution comes from three things:
// - Eighth blocks (▁▂▃▄▅▆▇█) give each cell eight steps of height, so bars of close values
//   still differ.
// - A cell where one series ends and the next starts is split at the boundary: the lower
//   series as the block's foreground, the upper as its background. That is the most a cell
//   can show, two colours.
// - More periods than columns never squeezes or merges them. The chart keeps a column per
//   period and scrolls to the cursor, with ◀ ▶ marks for what is off screen.

import { linearScale } from '../../share-report/client/ui/charts/scale.js';
import { visibleWidth } from '../../render/table-text-layout.js';
import { seg, type Line, type Segment, type Style, type Tone } from '../view/line.js';

const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/** Fills that tell series apart without colour, in stack order. */
export const MONO_PATTERNS = ['█', '▓', '▒', '░', '▚', '▞', '▤', '▥'] as const;
const MONO_OTHER = '·';

export type ColumnSeries = {
  label: string;
  tone: Tone;
  /** True for the merged remainder (`Other`). */
  other: boolean;
};

export type ColumnSlot = {
  /** The label under the axis. */
  short: string;
  /** One value per series, bottom first; null for a period with nothing to measure. */
  values: readonly (number | null)[];
};

export type ColumnChartInput = {
  series: readonly ColumnSeries[];
  slots: readonly ColumnSlot[];
  /** Columns available, axis labels included. */
  width: number;
  /** Rows for the bars, without the axis and label rows under them. */
  height: number;
  /** The selected period; null shows the latest periods with no selection. */
  cursor: number | null;
  /** Draw without colour: series as glyph patterns. */
  mono: boolean;
  /** A tick's label, from the step between ticks. */
  tickFormat: (step: number) => (value: number) => string;
  /** A value drawn as a dashed line across, as the whole-view rate. */
  reference?: number | null;
  /** The y domain's top, when it is fixed (a rate's 100%). */
  max?: number;
};

export type ColumnChart = {
  lines: Line[];
  /** The periods on screen: `[start, end)`. */
  start: number;
  end: number;
};

export function seriesPattern(series: ColumnSeries, slot: number): string {
  return series.other ? MONO_OTHER : MONO_PATTERNS[slot % MONO_PATTERNS.length];
}

/** The total of one period's values; null when it has none to show. */
function slotTotal(slot: ColumnSlot): number | null {
  const present = slot.values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + Math.max(0, value), 0);
}

/** Where one period's bar sits on the plot, in columns from its left edge. */
export type ColumnPlacement = { x: number; width: number };

/** The widest a bar gets: past it, a few periods would draw as slabs. */
const MAX_BAR = 8;

/**
 * Bars of one width across the plot. With room for a gap, the leftover goes into the gaps;
 * with less, one-column bars touch, centred; with more periods than columns, one column each
 * and the chart scrolls.
 */
export function placeColumns(plotWidth: number, count: number): ColumnPlacement[] {
  const visible = Math.min(count, plotWidth);

  if (visible === 0) {
    return [];
  }

  const ratio = plotWidth / visible;

  if (ratio < 2) {
    // No room for gaps: one-column bars side by side, centred, so every bar has one width.
    const margin = Math.floor((plotWidth - visible) / 2);
    return Array.from({ length: visible }, (_, index) => ({ x: margin + index, width: 1 }));
  }

  const width = Math.min(MAX_BAR, Math.max(1, Math.floor(ratio) - 1));

  return Array.from({ length: visible }, (_, index) => ({
    x: Math.min(plotWidth - width, Math.round(index * ratio + (ratio - width) / 2)),
    width,
  }));
}

/** The first period on screen: the latest page with no cursor, else the cursor centred. */
export function visibleStart(count: number, visible: number, cursor: number | null): number {
  const last = Math.max(0, count - visible);

  if (cursor === null) {
    return last;
  }

  return Math.min(last, Math.max(0, cursor - Math.floor(visible / 2)));
}

/**
 * One cell of a column: `row` 0 is the bottom. `bounds` are the cumulative series tops in
 * eighths of a row.
 */
function drawCell(
  bounds: readonly number[],
  row: number,
  series: readonly ColumnSeries[],
  mono: boolean,
): Cell | undefined {
  const low = row * 8;
  const high = low + 8;
  const top = bounds[bounds.length - 1] ?? 0;

  if (top <= low) {
    return undefined;
  }

  const overlaps: { index: number; amount: number }[] = [];

  for (const [index, bound] of bounds.entries()) {
    const below = index === 0 ? 0 : bounds[index - 1];
    const amount = Math.min(bound, high) - Math.max(below, low);

    if (amount > 0) {
      overlaps.push({ index, amount });
    }
  }

  const largest = overlaps.reduce((best, entry) => (entry.amount > best.amount ? entry : best));
  const toneOf = (index: number) => series[index].tone;

  if (top < high) {
    return {
      char: EIGHTHS[top - low],
      style: mono ? undefined : { fg: toneOf(largest.index) },
    };
  }

  if (mono) {
    return { char: seriesPattern(series[largest.index], largest.index) };
  }

  if (overlaps.length === 1) {
    return { char: '█', style: { fg: toneOf(overlaps[0].index) } };
  }

  const lower = overlaps[0];
  const upper = overlaps[overlaps.length - 1];

  return {
    char: EIGHTHS[lower.amount],
    style: { fg: toneOf(lower.index), bg: toneOf(upper.index) },
  };
}

/** Adds a run of characters, merging it into the previous segment when the style matches. */
function push(line: Segment[], text: string, style?: Style): void {
  const last = line.at(-1);

  if (last !== undefined && JSON.stringify(last.style) === JSON.stringify(style)) {
    line[line.length - 1] = seg(last.text + text, style);
    return;
  }

  line.push(seg(text, style));
}

/**
 * Period labels centred under their bars where they fit, two spaces apart, never past the
 * edge; the selected period's label is placed first, so it always shows.
 */
export function placeLabels(
  labels: readonly string[],
  placements: readonly ColumnPlacement[],
  width: number,
  cursor: number | null,
): string {
  const placed: { at: number; end: number; text: string }[] = [];
  const order = [...labels.keys()];

  if (cursor !== null && cursor < labels.length) {
    order.splice(cursor, 1);
    order.unshift(cursor);
  }

  for (const slot of order) {
    const text = labels[slot];
    const length = visibleWidth(text);
    const { x, width: barWidth } = placements[slot];
    const at = Math.max(0, Math.min(width - length, x + Math.floor((barWidth - length) / 2)));
    const end = at + length;

    if (length === 0 || placed.some((other) => at < other.end + 2 && other.at < end + 2)) {
      continue;
    }

    placed.push({ at, end, text });
  }

  const row = new Array<string>(width).fill(' ');

  for (const { at, text } of placed) {
    let offset = 0;

    for (const character of text) {
      row[at + offset] = character;
      offset += 1;
    }
  }

  return row.join('');
}

type Cell = { char: string; style?: Style };

/** A row of cells as segments, runs of one style merged. */
function cellsToLine(cells: readonly Cell[]): Segment[] {
  const line: Segment[] = [];

  for (const entry of cells) {
    push(line, entry.char, entry.style);
  }

  return line;
}

export function renderColumnChart(input: ColumnChartInput): ColumnChart {
  const totals = input.slots.map(slotTotal);
  const dataMax = Math.max(0, ...totals.map((total) => total ?? 0), input.reference ?? 0);
  const height = Math.max(2, input.height);
  const scale = linearScale(
    input.max ?? dataMax,
    [0, height],
    Math.max(1, Math.min(5, Math.floor(height / 3))),
  );
  const format = input.tickFormat(scale.step);
  const tickLabels = scale.ticks.map(format);
  const labelWidth = Math.max(...tickLabels.map((label) => visibleWidth(label)));
  const plotWidth = Math.max(1, input.width - labelWidth - 2);
  const visible = Math.min(input.slots.length, plotWidth);
  const start = visibleStart(input.slots.length, visible, input.cursor);
  const end = start + visible;
  const shown = input.slots.slice(start, end);
  const placements = placeColumns(plotWidth, shown.length);
  const units = height * 8;
  const bounds = shown.map((slot) => {
    let sum = 0;
    return slot.values.map((value) => {
      sum += Math.max(0, value ?? 0);
      return Math.round((sum / scale.max) * units);
    });
  });
  const tickRows = new Map<number, string>();

  for (const [index, tick] of scale.ticks.entries()) {
    if (tick > 0) {
      tickRows.set(Math.max(0, Math.round((tick / scale.max) * height) - 1), tickLabels[index]);
    }
  }

  const referenceRow =
    input.reference === undefined || input.reference === null
      ? undefined
      : Math.min(height - 1, Math.floor((input.reference / scale.max) * height));
  const cursor = input.cursor === null ? null : input.cursor - start;
  const lines: Line[] = [];

  for (let row = height - 1; row >= 0; row -= 1) {
    const tick = tickRows.get(row);
    // The empty plot: a reference line, faint grid lines at the ticks, else blank.
    const background: Cell =
      row === referenceRow
        ? { char: '╌', style: { fg: 'accent' } }
        : tick === undefined
          ? { char: ' ' }
          : { char: '┈', style: { fg: 'rule' } };
    const cells: Cell[] = new Array<Cell>(plotWidth).fill(background);

    for (const [slot, slotBounds] of bounds.entries()) {
      const draw = drawCell(slotBounds, row, input.series, input.mono);

      if (draw === undefined) {
        continue;
      }

      const style =
        draw.style !== undefined && slot === cursor ? { ...draw.style, bold: true } : draw.style;
      const { x, width } = placements[slot];

      for (let column = x; column < x + width; column += 1) {
        cells[column] = { char: draw.char, style };
      }
    }

    lines.push([
      seg(`${(tick ?? '').padStart(labelWidth)} `, { fg: 'muted' }),
      seg(tick === undefined ? '│' : '┤', { fg: 'rule' }),
      ...cellsToLine(cells),
    ]);
  }

  lines.push([
    seg(`${(tickLabels[0] ?? '0').padStart(labelWidth)} `, { fg: 'muted' }),
    seg(`└${'─'.repeat(plotWidth)}`, { fg: 'rule' }),
  ]);
  lines.push([
    seg(' '.repeat(labelWidth + 2)),
    seg(
      placeLabels(
        shown.map((slot) => slot.short),
        placements,
        plotWidth,
        cursor,
      ),
      { fg: 'muted' },
    ),
  ]);
  lines.push(
    markerLine(labelWidth + 2, plotWidth, placements, cursor, start, end, input.slots.length),
  );

  return { lines, start, end };
}

/** The cursor's ▲ under its column, and ◀ ▶ when periods are off screen. */
function markerLine(
  indent: number,
  plotWidth: number,
  placements: readonly ColumnPlacement[],
  cursor: number | null,
  start: number,
  end: number,
  count: number,
): Line {
  const row = new Array<string>(plotWidth).fill(' ');

  const placement = cursor === null ? undefined : placements.at(cursor);

  if (placement !== undefined) {
    row[Math.min(plotWidth - 1, placement.x + Math.floor((placement.width - 1) / 2))] = '▲';
  }

  const line: Segment[] = [seg((start > 0 ? '◀' : '').padEnd(indent), { fg: 'muted' })];
  const marks = row.join('');

  if (end < count) {
    line.push(seg(marks.slice(0, Math.max(0, plotWidth - 1)), { fg: 'accent' }));
    line.push(seg('▶', { fg: 'muted' }));
  } else {
    line.push(seg(marks, { fg: 'accent' }));
  }

  return line;
}
