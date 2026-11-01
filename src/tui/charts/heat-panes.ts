// Heatmaps in terminal cells: tokens by hour of day and weekday, and the 5-hour blocks by the
// day and hour they start. Five levels on the share report's heat ramp (glyphs ·░▒▓█ without
// colour), the busiest cell named in words, and a cursor that reads any cell exactly.

import {
  buildBlockMatrix,
  buildHourWeekdayMatrix,
  WEEKDAY_LABELS,
} from '../../share-report/client/core/index.js';
import {
  buildBlockChart,
  buildHourWeekdayChart,
  findPeak,
} from '../../share-report/client/ui/charts/heatmaps.js';
import { heatLevel } from '../../share-report/client/ui/charts/scale.js';
import type { ChartView } from '../../share-report/client/ui/charts/svg.js';
import { formatCost, formatDay } from '../../share-report/client/ui/shell/format.js';
import type { ShareViewContext } from '../../share-report/client/ui/state/context.js';
import { pluralize } from '../../../packages/core/src/utils/pluralize.js';
import { formatAbbreviatedTokenCount, formatInteger } from '../../render/format-number.js';
import { seg, wrapWords, type Line, type Segment, type Style, type Tone } from '../view/line.js';
import { focusDetail, messageLines, noteLines, type PaneInput, type TuiPane } from './pane.js';

const MODEL_WIDTH = 720;
const MONO_LEVELS = ['·', '░', '▒', '▓', '█'] as const;
const HEAT_TONES = [
  'heat-0',
  'heat-1',
  'heat-2',
  'heat-3',
  'heat-4',
] as const satisfies readonly Tone[];

function hourLabel(hour: number): string {
  return String(hour).padStart(2, '0');
}

type HeatGridInput = {
  rowLabels: readonly string[];
  values: readonly (readonly number[])[];
  width: number;
  /** Lines the grid may use; the grid scrolls to keep the cursor row in view. */
  room: number;
  cursor: { x: number; y: number } | null;
  mono: boolean;
  /** Without a cursor, show the last rows (the latest days) rather than the first. */
  startAtEnd: boolean;
  /** The most lines one row may take: a short grid grows to fill its pane. */
  maxRowHeight: number;
  /** 16 colours: levels drawn as glyphs as well as tones. */
  basicColor: boolean;
};

/** Columns per hour: as wide as the pane allows (up to 8), a one-column gap from 2 up. */
function cellLayout(width: number, labelWidth: number): { step: number; fill: number } {
  const step = Math.max(1, Math.min(8, Math.floor((width - labelWidth - 1) / 24)));
  return { step, fill: step >= 2 ? step - 1 : 1 };
}

/** The 24 hours across the top, labelled where a label fits. */
function hourHeader(labelWidth: number, step: number): Line {
  const every = step >= 4 ? 2 : step >= 2 ? 3 : 6;
  let text = ' '.repeat(labelWidth + 1);

  for (let hour = 0; hour < 24; hour += 1) {
    const at = labelWidth + 1 + hour * step;

    if (hour % every === 0 && text.length <= at) {
      text = text.padEnd(at) + hourLabel(hour);
    }
  }

  return [seg(text, { fg: 'muted' })];
}

/**
 * The grid: one tile per cell. A row's last line is drawn with upper half blocks (▀), so rows
 * stay apart as tiles instead of merging into stripes; a taller row fills the lines above it.
 */
function heatGrid(input: HeatGridInput): { lines: Line[]; start: number; end: number } {
  const labelWidth = Math.max(3, ...input.rowLabels.map((label) => label.length));
  const layout = cellLayout(input.width, labelWidth);
  const max = Math.max(0, ...input.values.flat());
  const count = input.values.length;
  const rowHeight = Math.max(
    1,
    Math.min(input.maxRowHeight, Math.floor(input.room / Math.max(1, count))),
  );
  const rowsShown = Math.max(1, Math.min(count, Math.floor(input.room / rowHeight)));
  const start =
    input.cursor === null
      ? input.startAtEnd
        ? count - rowsShown
        : 0
      : Math.min(count - rowsShown, Math.max(0, input.cursor.y - Math.floor(rowsShown / 2)));
  const lines: Line[] = [hourHeader(labelWidth, layout.step)];

  for (let row = start; row < start + rowsShown; row += 1) {
    for (let part = 0; part < rowHeight; part += 1) {
      const last = part === rowHeight - 1;
      const label = part === Math.floor((rowHeight - 1) / 2) ? input.rowLabels[row] : '';
      const line: Segment[] = [seg(`${label.padStart(labelWidth)} `, { fg: 'muted' })];

      for (const [column, value] of input.values[row].entries()) {
        const level = heatLevel(value, max);
        const selected =
          input.cursor !== null && input.cursor.x === column && input.cursor.y === row;
        let text: string;
        let style: Style | undefined;

        if (input.mono) {
          text = (selected ? '◆' : MONO_LEVELS[level]).repeat(layout.fill);
          style = selected ? { bold: true } : undefined;
        } else if (level === 0 && !selected) {
          // No usage: a faint dot on the tile's last line, so the grid still reads.
          text = last ? '·'.padEnd(layout.fill) : ' '.repeat(layout.fill);
          style = { fg: 'rule' };
        } else if (input.basicColor && !selected) {
          // 16 colours cannot tell four reds apart: the glyph carries the level too.
          text = MONO_LEVELS[level].repeat(layout.fill);
          style = { fg: HEAT_TONES[level] };
        } else {
          text = (last ? '▀' : '█').repeat(layout.fill);
          style = { fg: selected ? 'ink' : HEAT_TONES[level] };
        }

        line.push(seg(text, style));

        if (layout.step > layout.fill) {
          line.push(seg(' '.repeat(layout.step - layout.fill)));
        }
      }

      lines.push(line);
    }
  }

  return { lines, start, end: start + rowsShown };
}

/** `Less · ░ ▒ ▓ █ More`, coloured as the levels are, then the peak in words. */
function heatLegend(peakText: string, mono: boolean): Line {
  return [
    seg('Less ', { fg: 'muted' }),
    ...HEAT_TONES.flatMap((tone, level) => [
      seg(mono || level === 0 ? MONO_LEVELS[level] : '█', mono ? undefined : { fg: tone }),
      seg(' '),
    ]),
    seg('More', { fg: 'muted' }),
    seg(`   ${peakText}`, { fg: 'muted' }),
  ];
}

function readout(text: string | undefined, width: number): Line[] {
  return text === undefined
    ? []
    : wrapWords(`◆ ${text}`, width)
        .slice(0, 2)
        .map((line) => [seg(line, { bold: true })]);
}

function withFocus(lines: Line[], input: PaneInput, view: ChartView, detailRoom: number): Line[] {
  if (input.focus) {
    return [...lines, ...focusDetail(view.notes, view.table, input.width, detailRoom, 0)];
  }

  const room = input.height - lines.length;
  return room > 0 ? [...lines, ...noteLines(view.notes, input.width).slice(0, room)] : lines;
}

function drawHourWeekday(input: PaneInput): Line[] {
  const { context, width, cursor, mono } = input;
  const view = buildHourWeekdayChart(context, MODEL_WIDTH);

  if (view.message !== undefined) {
    return messageLines(view.message, view.notes, width);
  }

  const matrix = buildHourWeekdayMatrix(context.report, context.cells, { kind: 'tokens' });
  const peak = findPeak(matrix.values);
  const peakText =
    peak === undefined
      ? 'No hourly usage'
      : `Busiest: ${WEEKDAY_LABELS[peak.row]} ${hourLabel(peak.column)}:00, ${formatAbbreviatedTokenCount(peak.value)} tokens`;
  const selectedText =
    cursor === null
      ? undefined
      : `${WEEKDAY_LABELS[cursor.y]} ${hourLabel(cursor.x)}:00: ${formatInteger(matrix.values[cursor.y][cursor.x])} tokens`;
  const readoutLines = readout(selectedText, width);
  const detailRoom = input.focus ? Math.floor(input.height * 0.35) : 0;
  const grid = heatGrid({
    rowLabels: WEEKDAY_LABELS,
    values: matrix.values,
    width,
    room: Math.max(7, input.height - 3 - readoutLines.length - detailRoom - view.notes.length),
    cursor,
    mono,
    startAtEnd: false,
    maxRowHeight: 5,
    basicColor: input.basicColor === true,
  });
  return withFocus(
    [...grid.lines, heatLegend(peakText, mono), ...readoutLines],
    input,
    view,
    detailRoom,
  );
}

function blockMatrices(context: ShareViewContext) {
  const { report, view, span } = context;

  if (span === undefined) {
    return undefined;
  }

  const mode = view.costMode;
  const tokens = buildBlockMatrix(report, view, span, { kind: 'tokens' });
  const costs =
    mode === null || report.data.meta.unavailableCostModes.includes(mode)
      ? undefined
      : buildBlockMatrix(report, view, span, { kind: 'cost', mode });

  return { tokens, costs };
}

function drawBlocks(input: PaneInput): Line[] {
  const { context, width, height, cursor, mono } = input;
  const view = buildBlockChart(context, MODEL_WIDTH);
  const matrices = blockMatrices(context);

  if (view.message !== undefined || matrices === undefined) {
    return messageLines(view.message ?? 'No usage in this view.', view.notes, width);
  }

  const { tokens, costs } = matrices;
  const peak = findPeak(tokens.values);
  const dayLabel = (day: string) => formatDay(day).slice(0, -5);
  const blockCount = tokens.counts.flat().reduce((sum, count) => sum + count, 0);
  const peakText =
    peak === undefined
      ? 'No blocks'
      : `Largest: ${dayLabel(tokens.days[peak.row])} ${hourLabel(peak.column)}:00, ${formatAbbreviatedTokenCount(peak.value)} tokens`;
  let selected: string | undefined;

  if (cursor !== null) {
    const count = tokens.counts[cursor.y][cursor.x];
    const when = `${formatDay(tokens.days[cursor.y])} ${hourLabel(cursor.x)}:00`;
    const cost = costs
      ? `, ${formatCost({ kind: 'value', ...costs.costs[cursor.y][cursor.x] }).text}`
      : '';
    selected =
      count === 0
        ? `${when}: no block starts`
        : `${when}: ${pluralize(count, 'block')}, ${formatInteger(tokens.values[cursor.y][cursor.x])} tokens${cost}`;
  }

  const readoutLines = readout(selected, width);
  const detailRoom = input.focus ? Math.floor(height * 0.35) : 0;
  const room = Math.max(1, height - 3 - readoutLines.length - detailRoom);
  const grid = heatGrid({
    rowLabels: tokens.days.map(dayLabel),
    values: tokens.values,
    width,
    room,
    cursor,
    mono,
    startAtEnd: true,
    maxRowHeight: 1,
    basicColor: input.basicColor === true,
  });
  const caption: Line = [
    seg(
      `${pluralize(blockCount, 'block')} · days ${grid.start + 1}–${grid.end} of ${tokens.days.length} · ←/→ ↑/↓ read a block`,
      { fg: 'muted' },
    ),
  ];

  return withFocus(
    [caption, ...grid.lines, heatLegend(peakText, mono), ...readoutLines],
    input,
    view,
    detailRoom,
  );
}

export const HOUR_WEEKDAY_PANE: TuiPane = {
  id: 'hour-weekday',
  title: 'Hour of day by weekday',
  shape: () => ({ columns: 24, rows: 7 }),
  render: drawHourWeekday,
};

export const BLOCKS_PANE: TuiPane = {
  id: 'blocks',
  title: '5-hour blocks',
  shape: (context) => ({
    columns: 24,
    rows: blockMatrices(context)?.tokens.days.length ?? 0,
    startRow: 'last',
  }),
  render: drawBlocks,
};
