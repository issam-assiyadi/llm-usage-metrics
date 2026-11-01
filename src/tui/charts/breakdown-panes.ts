// Ranked breakdowns as horizontal bars: projects by cost (tokens without one) and the model
// mix as each model's share of tokens beside its share of cost. Bars grow in eighths of a
// cell (▏▎▍▌▋▊▉█), so close shares still read apart.

import { addUsd } from '../../utils/usd-math.js';
import { formatUsdOrNone } from '../../share-report/client/core/index.js';
import {
  buildModelMixChart,
  buildProjectChart,
  rankDimension,
  shareOf,
  type RankedRow,
} from '../../share-report/client/ui/charts/breakdown.js';
import type { ChartView } from '../../share-report/client/ui/charts/svg.js';
import { formatPercent } from '../../share-report/client/ui/shell/format.js';
import type { ShareViewContext } from '../../share-report/client/ui/state/context.js';
import { formatAbbreviatedTokenCount } from '../../render/format-number.js';
import { visibleWidth } from '../../render/table-text-layout.js';
import { cell, seg, wrapWords, type Line, type Style, type Tone } from '../view/line.js';
import { focusDetail, legendLines, messageLines, type PaneInput, type TuiPane } from './pane.js';

const MODEL_WIDTH = 720;
const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;

/** A bar `share` of `width` cells long, in eighths. */
export function horizontalBar(share: number, width: number): string {
  const eighths = Math.round(Math.max(0, Math.min(1, share)) * width * 8);
  const full = Math.floor(eighths / 8);
  const rest = eighths % 8;
  const bar = '█'.repeat(full) + PARTIAL[rest];

  // A share above zero always shows, however small.
  return bar === '' && share > 0 ? '▏' : bar;
}

/** The rows on screen: all when they fit, else a window that keeps the cursor in view. */
function windowRows<Row>(
  rows: readonly Row[],
  room: number,
  cursor: number | null,
): {
  shown: Row[];
  start: number;
} {
  if (rows.length <= room) {
    return { shown: [...rows], start: 0 };
  }

  const start =
    cursor === null ? 0 : Math.min(rows.length - room, Math.max(0, cursor - Math.floor(room / 2)));

  return { shown: rows.slice(start, start + room), start };
}

function rankedLabel(row: RankedRow, noun: string): string {
  return row.merged > 0 ? `${row.label} (${row.merged} ${noun}s)` : row.label;
}

function tableReadout(view: ChartView, row: number | undefined, width: number): Line[] {
  const cells = row === undefined ? undefined : view.table?.rows[row];

  if (cells === undefined || view.table === undefined) {
    return [];
  }

  const text = view.table.columns
    .map((column, index) => (index === 0 ? cells[0] : `${column.label} ${cells[index]}`))
    .join(' · ');

  return wrapWords(`▸ ${text}`, width)
    .slice(0, 2)
    .map((line) => [seg(line, { bold: true })]);
}

function keepFor(focus: boolean): number {
  return focus ? 20 : 10;
}

function drawProjects(input: PaneInput): Line[] {
  const { context, width, height, cursor, mono } = input;
  const view = buildProjectChart('projects', context, MODEL_WIDTH);

  if (view.message !== undefined) {
    return messageLines(view.message, view.notes, width);
  }

  const byCost = ranksByCost(context);
  const rows = rankDimension(context, 'project', byCost ? 'cost' : 'tokens', keepFor(input.focus));
  const value = (row: RankedRow) => (byCost ? (row.cost ?? 0) : row.tokens);
  const total = byCost
    ? rows.reduce((sum, row) => addUsd(sum, row.cost ?? 0), 0)
    : rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = Math.max(...rows.map(value));
  const format = (amount: number) =>
    byCost ? formatUsdOrNone(amount) : formatAbbreviatedTokenCount(amount);
  const valueTexts = rows.map(
    (row) => `${format(value(row))} ${formatPercent(shareOf(value(row), total))}`,
  );
  const labelWidth = Math.min(28, Math.max(10, Math.floor(width * 0.32)));
  const valueWidth = Math.max(...valueTexts.map((text) => visibleWidth(text)));
  const barWidth = Math.max(4, width - labelWidth - valueWidth - 2);
  const selected = cursor?.y ?? null;
  const caption: Line = [
    seg(`${byCost ? 'By cost' : 'By tokens'} · ${format(total)} in total · ↑/↓ read a project`, {
      fg: 'muted',
    }),
  ];
  const readout = tableReadout(view, selected ?? undefined, width);
  const detailRoom = input.focus ? Math.max(0, Math.floor(height * 0.4)) : 0;
  const room = Math.max(1, height - 1 - readout.length - detailRoom);
  const { shown, start } = windowRows(rows, room, selected);
  const lines: Line[] = [caption];

  for (const [offset, row] of shown.entries()) {
    const index = start + offset;
    const tone: Tone = row.merged > 0 ? 'series-other' : 'series-0';
    const labelStyle: Style | undefined = index === selected ? { inverse: true } : undefined;
    const bar = horizontalBar(max > 0 ? value(row) / max : 0, barWidth);

    lines.push([
      seg(cell(rankedLabel(row, 'project'), labelWidth), labelStyle),
      seg(' '),
      seg(bar, mono ? undefined : { fg: tone }),
      seg(' '.repeat(Math.max(1, barWidth - visibleWidth(bar) + 1))),
      seg(cell(valueTexts[index], valueWidth, 'right'), { fg: 'muted' }),
    ]);
  }

  lines.push(...readout);

  if (input.focus) {
    lines.push(...focusDetail(view.notes, view.table, width, detailRoom, 0));
  } else if (view.notes.length > 0 && lines.length < height) {
    lines.push(...messageLines('', view.notes, width).slice(0, height - lines.length));
  }

  return lines;
}

function drawModelMix(input: PaneInput): Line[] {
  const { context, width, height, cursor, mono } = input;
  const view = buildModelMixChart('model-mix', context, MODEL_WIDTH);

  if (view.message !== undefined) {
    return messageLines(view.message, view.notes, width);
  }

  const rows = rankDimension(context, 'model', 'tokens', keepFor(input.focus));
  const tokenTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
  const costTotal = rows.reduce((sum, row) => addUsd(sum, row.cost ?? 0), 0);
  const withCost = view.description.includes('of cost');
  const labelWidth = Math.min(28, Math.max(10, Math.floor(width * 0.3)));
  const halves = withCost ? 2 : 1;
  const half = Math.max(8, Math.floor((width - labelWidth - 1) / halves));
  const barWidth = Math.max(3, half - 8);
  const selected = cursor?.y ?? null;
  const legend = legendLines(
    [
      { label: 'Share of tokens', value: '', tone: 'series-1', glyph: mono ? '▓' : '█' },
      ...(withCost
        ? [{ label: 'Share of cost', value: '', tone: 'series-0' as const, glyph: '█' }]
        : []),
    ],
    width,
    mono,
  );
  const readout = tableReadout(view, selected ?? undefined, width);
  const detailRoom = input.focus ? Math.max(0, Math.floor(height * 0.4)) : 0;
  const room = Math.max(1, height - legend.length - readout.length - detailRoom);
  const { shown, start } = windowRows(rows, room, selected);
  const lines: Line[] = [...legend];
  const barCell = (share: number | null, tone: Tone, glyph: string): Line => {
    const bar = horizontalBar(share ?? 0, barWidth).replaceAll('█', glyph);
    return [
      seg(bar, mono ? undefined : { fg: tone }),
      seg(' '.repeat(Math.max(1, barWidth - visibleWidth(bar) + 1))),
      seg(cell(formatPercent(share), 6, 'right'), { fg: 'muted' }),
    ];
  };

  for (const [offset, row] of shown.entries()) {
    const index = start + offset;
    lines.push([
      seg(
        cell(rankedLabel(row, 'model'), labelWidth),
        index === selected ? { inverse: true } : undefined,
      ),
      seg(' '),
      ...barCell(shareOf(row.tokens, tokenTotal), 'series-1', mono ? '▓' : '█'),
      ...(withCost
        ? [seg('  '), ...barCell(shareOf(row.cost ?? 0, costTotal), 'series-0', '█')]
        : []),
    ]);
  }

  lines.push(...readout);

  if (input.focus) {
    lines.push(...focusDetail(view.notes, view.table, width, detailRoom, 0));
  }

  return lines;
}

/** Projects rank by cost when the view has a priced cost mode, as the share report's chart. */
function ranksByCost(context: ShareViewContext): boolean {
  const mode = context.view.costMode;
  return mode !== null && !context.report.data.meta.unavailableCostModes.includes(mode);
}

function rankedCount(context: ShareViewContext, dimension: 'project' | 'model', focus: boolean) {
  const by = dimension === 'project' && ranksByCost(context) ? 'cost' : 'tokens';
  return rankDimension(context, dimension, by, keepFor(focus)).length;
}

export const PROJECTS_PANE: TuiPane = {
  id: 'projects',
  title: 'Projects',
  shape: (context, focus) => ({ columns: 0, rows: rankedCount(context, 'project', focus) }),
  render: drawProjects,
};

export const MODEL_MIX_PANE: TuiPane = {
  id: 'model-mix',
  title: 'Model mix',
  shape: (context, focus) => ({ columns: 0, rows: rankedCount(context, 'model', focus) }),
  render: drawModelMix,
};
