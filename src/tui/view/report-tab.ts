// The Report tab: the share report's lead panels (year in review, summary, trends, compare,
// efficiency, optimize), drawn from the embedded command report. Like on the page, the
// controls never change them; the tab scrolls with ↑/↓.

import type { ShareReport } from '../../share-report/client/core/index.js';
import { buildCompareView } from '../../share-report/client/ui/panels/compare-model.js';
import { buildEfficiencyView } from '../../share-report/client/ui/panels/efficiency-model.js';
import {
  SHARE_PANEL_HEADINGS,
  type PanelView,
  type SharePanelId,
} from '../../share-report/client/ui/panels/model.js';
import { buildOptimizeView } from '../../share-report/client/ui/panels/optimize-model.js';
import { buildSummaryView } from '../../share-report/client/ui/panels/summary-model.js';
import { buildTrendsView } from '../../share-report/client/ui/panels/trends-model.js';
import { buildWrappedView } from '../../share-report/client/ui/panels/wrapped-model.js';
import type { ShareLabels } from '../../share-report/client/ui/state/context.js';
import { renderColumnChart } from '../charts/columns.js';
import { horizontalBar } from '../charts/breakdown-panes.js';
import { calendarLines, factCards, ledeLines, panelTableLines } from './blocks.js';
import { cell, seg, wrapWords, type Line } from './line.js';

function spacer(): Line {
  return [seg('')];
}

function noteLine(note: string, width: number): Line[] {
  return wrapWords(note, width).map((text) => [seg(text, { dim: true })]);
}

function panelViewLines(view: PanelView, width: number): Line[] {
  return [
    ...ledeLines(view.lede, width),
    spacer(),
    ...factCards(view.facts, width),
    ...view.tables.flatMap((table) => [spacer(), ...panelTableLines(table, width)]),
    spacer(),
    ...noteLine(view.note, width),
  ];
}

function summaryLines(
  report: ShareReport,
  labels: ShareLabels,
  width: number,
  mono: boolean,
  basic: boolean,
) {
  const view = buildSummaryView(report, labels);

  if (view === undefined) {
    return undefined;
  }

  return [
    ...ledeLines(view.lede, width),
    spacer(),
    ...factCards(view.month, width),
    ...factCards(view.activity, width),
    spacer(),
    ...calendarLines(view.calendar, width, mono, basic),
    ...view.tables.flatMap((table) => [spacer(), ...panelTableLines(table, width)]),
    spacer(),
    ...noteLine(view.note, width),
  ];
}

function trendsLines(report: ShareReport, labels: ShareLabels, width: number, mono: boolean) {
  const view = buildTrendsView(report, labels);

  if (view === undefined) {
    return undefined;
  }

  const chartLines: Line[] = [];

  if (view.chart !== undefined) {
    const { chart } = view;
    // The page's bars are in SVG units; their heights keep the proportions the terminal needs.
    const drawn = renderColumnChart({
      series: [{ label: view.title, tone: 'series-0', other: false }],
      slots: chart.bars.map((bar) => ({ short: '', values: [bar.height] })),
      width,
      height: 8,
      cursor: null,
      mono,
      tickFormat: () => () => '',
    });
    chartLines.push(
      ...drawn.lines.slice(0, -2),
      [seg(chart.dates.join('  ·  '), { fg: 'muted' })],
      [seg(`${chart.peak}  ·  ${chart.average.label}`, { fg: 'muted' })],
    );
  }

  return [
    [seg(view.title, { bold: true })],
    ...ledeLines(view.lede, width),
    spacer(),
    ...chartLines,
    spacer(),
    ...panelTableLines(view.days, width),
    ...view.tables.flatMap((table) => [spacer(), ...panelTableLines(table, width)]),
    spacer(),
    ...noteLine(view.note, width),
  ];
}

function wrappedLines(report: ShareReport, width: number, mono: boolean, basic: boolean) {
  const view = buildWrappedView(report);

  if (view === undefined) {
    return undefined;
  }

  const topLists = view.topLists.flatMap((list) => {
    const nameWidth = Math.min(28, Math.floor(width * 0.35));
    const barWidth = Math.max(4, width - nameWidth - 30);

    return [
      spacer(),
      [seg(list.title, { bold: true })],
      ...list.items.map((item) => [
        seg(`${String(item.rank).padStart(2)}. ${cell(item.name, nameWidth)} `),
        seg(
          horizontalBar(item.share, barWidth).padEnd(barWidth),
          mono ? undefined : { fg: 'series-0' },
        ),
        seg(` ${cell(item.tokens, 9, 'right')} ${cell(item.cost, 10, 'right')}`, { fg: 'muted' }),
      ]),
    ];
  });

  return [
    [seg(view.year, { bold: true, fg: 'accent' })],
    ...ledeLines(view.lede, width),
    spacer(),
    ...factCards(view.facts, width),
    spacer(),
    ...calendarLines(view.calendar, width, mono, basic),
    spacer(),
    ...panelTableLines(view.months, width),
    ...topLists,
    spacer(),
    ...noteLine(view.note, width),
  ];
}

function panelLines(
  id: SharePanelId,
  report: ShareReport,
  labels: ShareLabels,
  width: number,
  mono: boolean,
  basic: boolean,
): Line[] | undefined {
  switch (id) {
    case 'wrapped-recap':
      return wrappedLines(report, width, mono, basic);
    case 'summary':
      return summaryLines(report, labels, width, mono, basic);
    case 'trends':
      return trendsLines(report, labels, width, mono);
    case 'compare': {
      const view = buildCompareView(report, labels);
      return view && panelViewLines(view, width);
    }
    case 'efficiency': {
      const view = buildEfficiencyView(report);
      return view && panelViewLines(view, width);
    }
    case 'optimize': {
      const view = buildOptimizeView(report);
      return view && panelViewLines(view, width);
    }
  }
}

/** Every panel the report embeds, titled, one after another; a note when it embeds none. */
export function renderReportTab(
  report: ShareReport,
  labels: ShareLabels,
  width: number,
  mono: boolean,
  basic = false,
): Line[] {
  const lines = SHARE_PANEL_HEADINGS.flatMap((heading) => {
    if (report.data.envelope?.report !== heading.report) {
      return [];
    }

    const body = panelLines(heading.id, report, labels, width, mono, basic);

    return body === undefined
      ? []
      : [[seg(`▍${heading.title}`, { bold: true, fg: 'accent' })], spacer(), ...body, spacer()];
  });

  return lines.length > 0
    ? lines
    : [
        [
          seg('This report embeds no command summary; the other tabs hold every chart.', {
            fg: 'muted',
          }),
        ],
      ];
}
