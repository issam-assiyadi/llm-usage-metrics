// The charts over time: cost and tokens as stacked columns, the cache hit rate and cost per
// active hour as single columns against the whole view's rate. The words (messages, notes,
// tables) come from the share report's own chart models, so both say the same thing.

import { addUsd } from '../../utils/usd-math.js';
import {
  formatUsdOrNone,
  getPeriodAxis,
  OTHER_SERIES_LABEL,
  stackByDimension,
  type ShareMetric,
} from '../../share-report/client/core/index.js';
import { DIMENSION_LABELS } from '../../share-report/client/ui/controls/model.js';
import {
  formatAxisValue,
  formatPeriod,
  usdTickFormat,
} from '../../share-report/client/ui/charts/frame.js';
import {
  buildOverTimeChart,
  type OverTimeMetric,
} from '../../share-report/client/ui/charts/over-time.js';
import { SERIES_COLOURS } from '../../share-report/client/ui/charts/paint.js';
import {
  buildCacheHitChart,
  buildCostPerHourChart,
  getCacheHitSeries,
  getCostPerHourSeries,
} from '../../share-report/client/ui/charts/rates.js';
import type { ChartView } from '../../share-report/client/ui/charts/svg.js';
import { formatPercent } from '../../share-report/client/ui/shell/format.js';
import type { ShareViewContext } from '../../share-report/client/ui/state/context.js';
import { formatInteger } from '../../render/format-number.js';
import { seg, seriesTone, wrapWords, type Line, type Tone } from '../view/line.js';
import { renderColumnChart, seriesPattern, type ColumnSeries, type ColumnSlot } from './columns.js';
import {
  focusDetail,
  legendLines,
  messageLines,
  type Cursor,
  type PaneInput,
  type PaneShape,
  type TuiPane,
} from './pane.js';

/** The share report renders its words at this width; the TUI only reads them. */
const MODEL_WIDTH = 720;

type TimeSeriesDraw = {
  view: ChartView;
  series: ColumnSeries[];
  slots: ColumnSlot[];
  /** Each period's long name, for the readout. */
  longs: string[];
  caption: string;
  tickFormat: (step: number) => (value: number) => string;
  /** A value as the readout writes it. */
  exact: (value: number | null) => string;
  legend: { label: string; value: string }[];
  reference?: number | null;
  max?: number;
};

/** Splits a pane body between the chart and, in focus mode, the notes and table under it. */
function layoutRows(input: PaneInput, fixed: number): { chart: number; detail: number } {
  if (!input.focus) {
    return { chart: Math.max(3, input.height - fixed - 3), detail: 0 };
  }

  const chart = Math.max(6, Math.floor(input.height * 0.55) - fixed - 3);
  return { chart, detail: Math.max(0, input.height - fixed - 3 - chart) };
}

function readoutLine(draw: TimeSeriesDraw, cursor: Cursor | null, width: number): Line[] {
  if (cursor === null) {
    return [[seg(draw.caption, { fg: 'muted' })]];
  }

  const slot = draw.slots.at(cursor.x);

  if (slot === undefined) {
    return [];
  }

  const present = slot.values.flatMap((value, index) =>
    value === null || value === 0 ? [] : [{ value, series: draw.series[index] }],
  );
  const total = present.reduce((sum, entry) => sum + entry.value, 0);
  const head = `▲ ${draw.longs[cursor.x]}: ${draw.exact(present.length === 0 ? null : total)}`;
  const parts =
    draw.series.length > 1
      ? present.map((entry) => `${entry.series.label} ${draw.exact(entry.value)}`)
      : [];
  const text = [head, ...parts].join(' · ');

  return wrapWords(text, width)
    .slice(0, 2)
    .map((line, index) => [seg(line, index === 0 ? { bold: true } : undefined)]);
}

function renderTimeSeries(input: PaneInput, draw: TimeSeriesDraw): Line[] {
  const { width } = input;

  if (draw.view.message !== undefined || draw.slots.length === 0) {
    return messageLines(draw.view.message ?? 'No usage in this view.', draw.view.notes, width);
  }

  const legend = legendLines(
    draw.legend.map((entry, index) => ({
      ...entry,
      tone: draw.series[index].tone,
      glyph: input.mono ? seriesPattern(draw.series[index], index) : '█',
    })),
    width,
    input.mono,
  );
  const readout = readoutLine(draw, input.cursor, width);
  const rows = layoutRows(input, legend.length + readout.length);
  const chart = renderColumnChart({
    series: draw.series,
    slots: draw.slots,
    width,
    height: rows.chart,
    cursor: input.cursor?.x ?? null,
    mono: input.mono,
    tickFormat: draw.tickFormat,
    reference: draw.reference,
    max: draw.max,
  });
  const lines = [...legend, ...chart.lines, ...readout];

  if (input.focus) {
    lines.push(
      ...focusDetail(draw.view.notes, draw.view.table, width, rows.detail, input.cursor?.y ?? 0),
    );
  }

  return lines;
}

function tableShape(view: ChartView, focus: boolean): number {
  return focus ? (view.table?.rows.length ?? 0) : 0;
}

const GRANULARITY_WORDS = { hour: 'hour', day: 'day', week: 'week', month: 'month' } as const;

function drawOverTime(
  chartId: string,
  metric: OverTimeMetric,
  context: ShareViewContext,
): TimeSeriesDraw {
  const view = buildOverTimeChart(chartId, metric, context, MODEL_WIDTH);
  const base = {
    view,
    series: [],
    slots: [],
    longs: [],
    caption: '',
    tickFormat: usdTickFormat,
    exact: formatUsdOrNone,
    legend: [],
  };
  const { report, cells, span, labels } = context;
  const { granularity, stackBy, costMode } = context.view;

  if (view.message !== undefined || span === undefined) {
    return base;
  }

  const shareMetric: ShareMetric =
    metric === 'tokens' || costMode === null
      ? { kind: 'tokens' }
      : { kind: 'cost', mode: costMode };
  const axis = getPeriodAxis(report, span, granularity);
  const stack = stackByDimension(report, cells, {
    axis,
    granularity,
    dimension: stackBy,
    metric: shareMetric,
    maxSeries: SERIES_COLOURS,
  });
  const unit = metric === 'tokens' ? 'tokens' : 'usd';
  const add = unit === 'usd' ? addUsd : (left: number, right: number) => left + right;
  const exact = (value: number | null) =>
    value === null
      ? formatUsdOrNone(null)
      : unit === 'usd'
        ? formatUsdOrNone(value)
        : formatInteger(value);
  const grand = stack.series.reduce((sum, series) => add(sum, series.total), 0);
  const series = stack.series.map((entry, slot) => ({
    label: entry.index === null ? OTHER_SERIES_LABEL : labels.of(stackBy, entry.index),
    tone: seriesTone(slot, entry.index === null),
    other: entry.index === null,
  }));
  const periods = axis.map((key) => formatPeriod(key, granularity));

  return {
    view,
    series,
    slots: axis.map((_, slot) => ({
      short: periods[slot].short,
      values: stack.series.map((entry) => entry.values[slot]),
    })),
    longs: periods.map((period) => period.long),
    caption: `${exact(grand)} in total · per ${GRANULARITY_WORDS[granularity]}, stacked by ${DIMENSION_LABELS[stackBy].one.toLowerCase()} · ←/→ read a period`,
    tickFormat:
      unit === 'usd' ? usdTickFormat : () => (value: number) => formatAxisValue(value, 'tokens'),
    exact,
    legend: stack.series.map((entry, slot) => ({
      label: series[slot].label,
      value: formatAxisValue(entry.total, unit),
    })),
  };
}

function overTimePane(id: string, title: string, metric: OverTimeMetric): TuiPane {
  return {
    id,
    title,
    shape: (context, focus): PaneShape => {
      const draw = drawOverTime(id, metric, context);
      return { columns: draw.slots.length, rows: tableShape(draw.view, focus) };
    },
    render: (input) => renderTimeSeries(input, drawOverTime(id, metric, input.context)),
  };
}

function rateDraw(
  view: ChartView,
  context: ShareViewContext,
  series: { axis: string[]; values: (number | null)[]; overall: number | null } | undefined,
  options: {
    label: string;
    tone: Tone;
    exact: (value: number | null) => string;
    tickFormat: (step: number) => (value: number) => string;
    max?: number;
  },
): TimeSeriesDraw {
  const { granularity } = context.view;

  if (view.message !== undefined || series === undefined) {
    return {
      view,
      series: [],
      slots: [],
      longs: [],
      caption: '',
      tickFormat: options.tickFormat,
      exact: options.exact,
      legend: [],
    };
  }

  const periods = series.axis.map((key) => formatPeriod(key, granularity));

  return {
    view,
    series: [{ label: options.label, tone: options.tone, other: false }],
    slots: series.axis.map((_, slot) => ({
      short: periods[slot].short,
      values: [series.values[slot]],
    })),
    longs: periods.map((period) => period.long),
    caption: `┄ whole view ${options.exact(series.overall)} · per ${GRANULARITY_WORDS[granularity]} · ←/→ read a period`,
    tickFormat: options.tickFormat,
    exact: options.exact,
    legend: [{ label: options.label, value: `(whole view ${options.exact(series.overall)})` }],
    reference: series.overall,
    max: options.max,
  };
}

function drawCacheHit(context: ShareViewContext): TimeSeriesDraw {
  const view = buildCacheHitChart(context, MODEL_WIDTH);
  const series = context.span === undefined ? undefined : getCacheHitSeries(context, context.span);

  return rateDraw(view, context, series, {
    label: 'Cache hit rate',
    tone: 'series-1',
    exact: formatPercent,
    tickFormat: () => (value) => `${Math.round(value * 100)}%`,
    max: 1,
  });
}

function drawCostPerHour(context: ShareViewContext): TimeSeriesDraw {
  const view = buildCostPerHourChart(context, MODEL_WIDTH);
  const mode = context.view.costMode;
  const series =
    context.span === undefined || mode === null || view.message !== undefined
      ? undefined
      : getCostPerHourSeries(context, context.span, mode);

  return rateDraw(view, context, series, {
    label: 'Cost per active hour',
    tone: 'series-0',
    exact: formatUsdOrNone,
    tickFormat: usdTickFormat,
  });
}

function ratePane(
  id: string,
  title: string,
  draw: (context: ShareViewContext) => TimeSeriesDraw,
): TuiPane {
  return {
    id,
    title,
    shape: (context, focus) => {
      const drawn = draw(context);
      return { columns: drawn.slots.length, rows: tableShape(drawn.view, focus) };
    },
    render: (input) => renderTimeSeries(input, draw(input.context)),
  };
}

export const COST_OVER_TIME_PANE = overTimePane('cost-over-time', 'Cost over time', 'cost');
export const TOKENS_OVER_TIME_PANE = overTimePane('tokens-over-time', 'Tokens over time', 'tokens');
export const CACHE_HIT_PANE = ratePane('cache-hit-rate', 'Cache hit rate', drawCacheHit);
export const COST_PER_HOUR_PANE = ratePane(
  'cost-per-active-hour',
  'Cost per active hour',
  drawCostPerHour,
);
