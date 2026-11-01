// The whole screen as lines: a WebTUI-style box with the report title and badges in its top
// border, tabs and the view's controls under it, the tab's panes, and key hints in the bottom
// border. Pure: the app renders what this returns and builds each action's environment here.

import type { ShareNameMask, ShareReport } from '../share-report/client/core/index.js';
import {
  countDimensionTokens,
  DIMENSION_LABELS,
  getCostModeOptions,
  getFilterGroups,
  getGranularityOptions,
  getStackOptions,
  type DimensionTokens,
  type FilterGroup,
} from '../share-report/client/ui/controls/model.js';
import {
  buildHeader,
  buildSummary,
  COST_MODE_LABELS,
  getEmptyState,
} from '../share-report/client/ui/shell/model.js';
import {
  buildViewContext,
  createLabels,
  type ShareViewContext,
} from '../share-report/client/ui/state/context.js';
import { getPeriodPresets } from '../share-report/client/ui/state/view.js';
import { formatAbbreviatedTokenCount } from '../render/format-number.js';
import { MODEL_MIX_PANE, PROJECTS_PANE } from './charts/breakdown-panes.js';
import { BLOCKS_PANE, HOUR_WEEKDAY_PANE } from './charts/heat-panes.js';
import { clampCursor, type TuiPane } from './charts/pane.js';
import {
  CACHE_HIT_PANE,
  COST_OVER_TIME_PANE,
  COST_PER_HOUR_PANE,
  TOKENS_OVER_TIME_PANE,
} from './charts/time-panes.js';
import type { CollectedMessage } from './diagnostics.js';
import { KEY_HELP } from './state/keymap.js';
import {
  TAB_IDS,
  visibleFilterOptions,
  type Modal,
  type TabId,
  type TuiEnv,
  type TuiState,
} from './state/tui-state.js';
import { statCards } from './view/blocks.js';
import {
  besides,
  cell,
  fitLine,
  frame,
  keyCap,
  lineWidth,
  pill,
  seg,
  shorten,
  wrapWords,
  type Line,
  type Segment,
} from './view/line.js';
import { getTableView, renderProjectsTab } from './view/projects-tab.js';
import { renderReportTab } from './view/report-tab.js';
import { renderTextTable } from './view/text-table.js';

export const MIN_WIDTH = 80;
export const MIN_HEIGHT = 24;
/** Rows a stacked pane needs before the layout prefers stacking to side by side. */
const STACKED_PANE_MIN_HEIGHT = 16;

export const TABS: readonly { id: TabId; title: string; panes: readonly TuiPane[] }[] = [
  { id: 'overview', title: 'Overview', panes: [COST_OVER_TIME_PANE, TOKENS_OVER_TIME_PANE] },
  { id: 'breakdown', title: 'Breakdown', panes: [PROJECTS_PANE, MODEL_MIX_PANE] },
  { id: 'rates', title: 'Rates', panes: [CACHE_HIT_PANE, COST_PER_HOUR_PANE] },
  { id: 'activity', title: 'Activity', panes: [HOUR_WEEKDAY_PANE, BLOCKS_PANE] },
  { id: 'projects', title: 'Projects', panes: [] },
  { id: 'report', title: 'Report', panes: [] },
];

function tabOf(id: TabId) {
  return TABS[TAB_IDS.indexOf(id)];
}

/** What every part of a screen draws from, computed once per state. */
export type ScreenModel = {
  report: ShareReport;
  state: TuiState;
  context: ShareViewContext;
  filterGroups: FilterGroup[];
  tokens: DimensionTokens;
  diagnostics: readonly CollectedMessage[];
};

export function createScreenModel(
  report: ShareReport,
  state: TuiState,
  mask: () => ShareNameMask,
  tokens: DimensionTokens,
  diagnostics: readonly CollectedMessage[],
): ScreenModel {
  const labels = createLabels(report, state.ui.hideNames ? mask() : undefined);
  const context = buildViewContext(report, state.ui.view, labels, 'dark');

  return {
    report,
    state,
    context,
    filterGroups: getFilterGroups(report, tokens, state.ui.view, labels),
    tokens,
    diagnostics,
  };
}

export { countDimensionTokens };

type Size = { width: number; height: number };

/** How charts may draw: no colour at all, or only the 16 ANSI colours. */
type Paint = { mono: boolean; basic: boolean };

/** The content area inside the outer box: below the tabs and controls, above the hints. */
function contentSize(size: Size): Size {
  return { width: size.width - 4, height: size.height - 5 };
}

export function buildEnv(model: ScreenModel, size: Size, mono: boolean): TuiEnv {
  const { report, state, context } = model;
  const tab = tabOf(state.tab);
  const pane = tab.panes.at(state.pane);
  const content = contentSize(size);
  const table = getTableView(context, state.ui.page);

  return {
    report,
    panes: tab.panes.map((entry) => entry.id),
    paneShape: pane?.shape(context, state.focus),
    table: {
      rows: table.rows.length,
      pageCount: table.pageCount,
      drillOf: (row) => table.rows[row]?.drill,
      sortKeys: table.columns.flatMap((column) =>
        column.sortKey === undefined ? [] : [column.sortKey],
      ),
    },
    reportLines:
      state.tab === 'report'
        ? renderReportTab(report, context.labels, content.width, mono).length
        : 0,
    contentHeight: content.height,
    filterGroups: model.filterGroups,
    presets: getPeriodPresets(report),
    granularities: getGranularityOptions(report),
    costModes: getCostModeOptions(report),
    stacks: getStackOptions(),
    diagnosticsLines: model.diagnostics.length,
  };
}

function headerLines(model: ScreenModel, width: number): Line[] {
  const header = buildHeader(model.context);
  const warnings = model.diagnostics.filter(
    (message) => message.style === 'warn' || message.style === 'stderr',
  ).length;
  const badges: Segment[] = [
    ...header.badges
      .filter(
        (entry) =>
          entry.tone === 'notice' ||
          entry.text.startsWith('Names hidden') ||
          header.badges.length <= 2,
      )
      .slice(0, 3)
      .flatMap((entry) => [
        ...pill(shorten(entry.text, 40), entry.tone === 'notice' ? 'notice' : 'muted'),
        seg(' '),
      ]),
    ...(warnings > 0 ? pill(`${warnings} warning${warnings === 1 ? '' : 's'} · d`, 'notice') : []),
  ];
  const top = frame([], width, {
    title: `llm-usage · ${header.title}`,
    aside: badges.length > 0 ? trimTrailingSpace(badges) : undefined,
    rounded: true,
  })[0];

  return [
    top,
    boxed(tabLine(model.state.tab), width),
    boxed(controlsLine(model), width),
    divider(width),
  ];
}

function trimTrailingSpace(segments: Segment[]): Segment[] {
  return segments[segments.length - 1]?.text === ' ' ? segments.slice(0, -1) : segments;
}

function boxed(line: Line, width: number): Line {
  return [
    seg('│', { fg: 'rule' }),
    seg(' '),
    ...fitLine(line, width - 4),
    seg(' '),
    seg('│', { fg: 'rule' }),
  ];
}

function divider(width: number): Line {
  return [seg(`├${'─'.repeat(Math.max(0, width - 2))}┤`, { fg: 'rule' })];
}

function tabLine(active: TabId): Line {
  return TABS.flatMap((tab, index) =>
    tab.id === active
      ? [...pill(` ${index + 1} ${tab.title} `, 'accent', true), seg(' ')]
      : [seg(` ${index + 1}`, { fg: 'accent' }), seg(` ${tab.title}  `, { fg: 'muted' })],
  );
}

function controlsLine(model: ScreenModel): Line {
  const { view } = model.state.ui;
  const header = buildHeader(model.context);
  const filtered = model.filterGroups.filter((group) => group.filtered);
  const part = (label: string, value: string, key: string): Segment[] => [
    ...pill(key, 'muted', true),
    seg(` ${label} `, { fg: 'muted' }),
    seg(value, { bold: true }),
    seg('   '),
  ];
  return [
    ...part('period', header.period, 'p'),
    ...part('by', view.granularity, 'g'),
    ...(view.costMode === null
      ? []
      : part('cost', COST_MODE_LABELS[view.costMode].toLowerCase(), 'c')),
    ...part('stack', DIMENSION_LABELS[view.stackBy].one.toLowerCase(), 's'),
    ...pill('f', filtered.length === 0 ? 'muted' : 'accent', true),
    seg(' filters ', { fg: 'muted' }),
    seg(
      filtered.length === 0
        ? 'none'
        : filtered.map((group) => `${group.title.toLowerCase()} ${group.summary}`).join(' · '),
      filtered.length === 0 ? undefined : { fg: 'accent', bold: true },
    ),
  ];
}

function footerLine(state: TuiState, width: number): Line {
  // Whole hints only: a key cap cut in half would read as a stray block.
  const groups: Segment[][] = state.status
    ? [[seg(' '), ...pill(` ${shorten(state.status, width - 10)} `, 'accent', true), seg(' ')]]
    : KEY_HELP.flatMap((entry) => {
        if (entry.footer === undefined) {
          return [];
        }

        const [key, ...words] = entry.footer.split(' ');
        return [[seg(' '), ...keyCap(key, words.join(' ')), seg(' ')]];
      });
  const room = width - 6;
  // Help and quit always show; the hints before them go first when the line is short.
  const kept = groups.slice(-2);
  const optional = groups.slice(0, -2);
  let used = kept.reduce((sum, group) => sum + lineWidth(group), 0);
  const fittedOptional: Segment[][] = [];

  for (const group of optional) {
    const groupWidth = lineWidth(group);

    if (used + groupWidth > room) {
      break;
    }

    fittedOptional.push(group);
    used += groupWidth;
  }

  const fitted = [...fittedOptional, ...kept].flat();

  return frame([], width, { footer: fitted, rounded: true })[1];
}

function paneFrame(
  pane: TuiPane,
  model: ScreenModel,
  size: Size,
  active: boolean,
  focus: boolean,
  paint: Paint,
): Line[] {
  const bodyHeight = Math.max(1, size.height - 2);
  const bodyWidth = size.width - 4;
  const shape = pane.shape(model.context, focus);
  const cursor = active ? clampCursor(model.state.cursors[pane.id] ?? null, shape) : null;
  const body = pane
    .render({
      context: model.context,
      width: bodyWidth,
      height: bodyHeight,
      cursor,
      mono: paint.mono,
      basicColor: paint.basic,
      focus,
    })
    .slice(0, bodyHeight);

  while (body.length < bodyHeight) {
    body.push([]);
  }

  return frame(body, size.width, {
    title: pane.title,
    active,
    rounded: active,
    aside: active ? [seg(focus ? 'Esc back' : 'Enter focus', { fg: 'muted' })] : undefined,
  });
}

function emptyLines(model: ScreenModel, width: number): Line[] | undefined {
  const empty = getEmptyState(model.context);

  if (empty === undefined) {
    return undefined;
  }

  const hint =
    empty.action === 'reset-filters'
      ? 'Press x to clear the filters.'
      : empty.action === 'reset-view'
        ? 'Press r for the opening view, or p for another period.'
        : 'Run llm-usage again once you have usage.';

  return frame(
    [
      ...wrapWords(empty.body, width - 4).map((text) => [seg(text)]),
      [seg('')],
      [seg(hint, { fg: 'accent' })],
    ],
    width,
    { title: empty.title, rounded: true },
  );
}

function panesLines(
  model: ScreenModel,
  panes: readonly TuiPane[],
  size: Size,
  paint: Paint,
): Line[] {
  const { state } = model;

  if (state.focus) {
    const pane = panes.at(state.pane);
    return pane === undefined ? [] : paneFrame(pane, model, size, true, true, paint);
  }

  // Stacked panes get the full width, which reads best; side by side only when the terminal is
  // wide but too short to give each stacked pane a readable height.
  const stackedHeight = Math.floor(size.height / Math.max(1, panes.length));

  if (size.width >= 150 && panes.length === 2 && stackedHeight < STACKED_PANE_MIN_HEIGHT) {
    const half = Math.floor((size.width - 1) / 2);
    return besides(
      panes.map((pane, index) => ({
        width: index === 0 ? half : size.width - half - 1,
        lines: paneFrame(
          pane,
          model,
          { width: index === 0 ? half : size.width - half - 1, height: size.height },
          index === state.pane,
          false,
          paint,
        ),
      })),
    );
  }

  const each = stackedHeight;

  if (each >= 10) {
    return panes.flatMap((pane, index) =>
      paneFrame(
        pane,
        model,
        {
          width: size.width,
          height: index === panes.length - 1 ? size.height - each * (panes.length - 1) : each,
        },
        index === state.pane,
        false,
        paint,
      ),
    );
  }

  // Too short for every pane: the one with the keyboard, and the others named under it.
  const others = panes.filter((_, index) => index !== state.pane).map((pane) => pane.title);
  const pane = panes.at(state.pane);

  return [
    ...(pane === undefined
      ? []
      : paneFrame(pane, model, { width: size.width, height: size.height - 1 }, true, false, paint)),
    [seg(`Tab ▸ ${others.join(', ')}`, { fg: 'muted' })],
  ];
}

function contentLines(model: ScreenModel, size: Size, paint: Paint): Line[] {
  const { state, context } = model;

  if (state.modal !== null) {
    return modalLines(model, state.modal, size);
  }

  if (state.tab === 'report') {
    return renderReportTab(model.report, context.labels, size.width, paint.mono, paint.basic).slice(
      state.reportScroll,
      state.reportScroll + size.height,
    );
  }

  const empty = emptyLines(model, size.width);

  if (empty !== undefined) {
    return empty;
  }

  if (state.tab === 'projects') {
    const table = getTableView(context, state.ui.page);
    return renderProjectsTab(table, state.tableRow, size.width, size.height);
  }

  const tab = tabOf(state.tab);
  let lines: Line[] = [];
  let room = size.height;

  if (state.tab === 'overview' && !state.focus) {
    const cards = statCards(
      buildSummary(context).map((figure) => ({
        label: figure.label,
        value: figure.value,
        detail: figure.detail,
      })),
      size.width,
      size.height >= 34,
    );
    lines = cards;
    room -= cards.length;
  }

  return [...lines, ...panesLines(model, tab.panes, { width: size.width, height: room }, paint)];
}

function helpLines(size: Size): Line[] {
  return frame(
    renderTextTable({
      columns: [
        { label: 'Key', numeric: false },
        { label: 'What it does', numeric: false },
      ],
      rows: KEY_HELP.map((entry) => [entry.keys, entry.what]),
      width: size.width - 4,
    }),
    size.width,
    { title: 'Keys', rounded: true, active: true, footer: [seg(' Esc close ', { fg: 'muted' })] },
  );
}

function diagnosticsLines(model: ScreenModel, scroll: number, size: Size): Line[] {
  const wrapped = model.diagnostics.flatMap((message) => {
    const warning = message.style === 'warn' || message.style === 'stderr';
    return wrapWords(message.text, size.width - 6).map((text, index) => [
      seg(index === 0 ? (warning ? '⚠ ' : '• ') : '  ', { fg: warning ? 'notice' : 'muted' }),
      seg(text, warning ? undefined : { fg: 'muted' }),
    ]);
  });
  const body =
    wrapped.length === 0
      ? [[seg('No warnings while reading.', { fg: 'muted' })]]
      : wrapped.slice(scroll, scroll + size.height - 2);

  return frame(body, size.width, {
    title: `Messages while reading (${model.diagnostics.length})`,
    rounded: true,
    active: true,
    footer: [seg(' ↑/↓ scroll · Esc close ', { fg: 'muted' })],
  });
}

function periodLines(
  model: ScreenModel,
  modal: Extract<Modal, { kind: 'period' }>,
  size: Size,
): Line[] {
  const presets = getPeriodPresets(model.report);
  const names = [...presets.map((preset) => preset.label), 'Custom range…'];
  const nameWidth = Math.max(...names.map((name) => name.length));
  const rows: Line[] = names.map((label, index) => [
    seg(index === modal.row ? '› ' : '  ', { fg: 'accent' }),
    seg(
      label.padEnd(nameWidth),
      index === modal.row ? { bold: true, inverse: modal.editing === undefined } : undefined,
    ),
    seg(
      index < presets.length
        ? `   ${presets[index].since ?? 'start'} → ${presets[index].until ?? 'now'}`
        : '',
      { fg: 'muted' },
    ),
  ]);
  const editing = modal.editing;
  const field = (name: 'from' | 'to', value: string): Segment[] => [
    seg(`${name === 'from' ? 'From' : 'To'} `, { fg: 'muted' }),
    seg(
      ` ${value.padEnd(10, '_')} `,
      editing?.field === name ? { inverse: true, fg: 'accent' } : { fg: 'ink' },
    ),
    seg('   '),
  ];

  return frame(
    [
      ...rows,
      ...(editing === undefined
        ? []
        : [
            [seg('')],
            [...field('from', editing.from), ...field('to', editing.to)],
            [
              seg(editing.error ?? 'Type YYYY-MM-DD · Tab switches field · Enter applies', {
                fg: editing.error ? 'notice' : 'muted',
              }),
            ],
          ]),
    ],
    size.width,
    {
      title: 'Period',
      rounded: true,
      active: true,
      footer: [seg(' ↑/↓ pick · Enter apply · Esc close ', { fg: 'muted' })],
    },
  );
}

function filterLines(
  model: ScreenModel,
  modal: Extract<Modal, { kind: 'filters' }>,
  size: Size,
): Line[] {
  const groups = model.filterGroups;
  const group = groups.at(modal.group);
  const tabs: Line = groups.flatMap((entry, index) => [
    seg(
      ` ${entry.title} · ${shorten(entry.summary, 16)} `,
      index === modal.group ? { inverse: true, fg: 'accent', bold: true } : { fg: 'muted' },
    ),
    seg(' '),
  ]);
  const options = visibleFilterOptions(modal, groups);
  const room = Math.max(1, size.height - 6);
  const start = Math.min(
    Math.max(0, options.length - room),
    Math.max(0, modal.row - Math.floor(room / 2)),
  );
  const tokens = group === undefined ? [] : model.tokens[group.dimension];
  const labelWidth = Math.max(10, size.width - 22);
  const list = options.slice(start, start + room).map((option, offset) => {
    const index = start + offset;
    return [
      seg(index === modal.row ? '› ' : '  ', { fg: 'accent' }),
      seg(
        option.selected ? '[x] ' : '[ ] ',
        option.selected ? { fg: 'accent', bold: true } : { fg: 'muted' },
      ),
      seg(cell(option.label, labelWidth), index === modal.row ? { inverse: true } : undefined),
      seg(cell(formatAbbreviatedTokenCount(tokens[option.index] ?? 0), 8, 'right'), {
        fg: 'muted',
      }),
    ];
  });
  const search: Line = [
    seg('/ ', { fg: 'accent' }),
    seg(
      modal.searching || modal.query !== '' ? modal.query + (modal.searching ? '▏' : '') : 'search',
      modal.searching ? { bold: true } : { dim: true },
    ),
    seg(`   ${options.length} of ${group?.options.length ?? 0}`, { fg: 'muted' }),
  ];

  return frame([tabs, search, ...list], size.width, {
    title: 'Filters',
    rounded: true,
    active: true,
    footer: [
      seg(' ←/→ dimension · Space toggle · a all · / search · Enter done ', { fg: 'muted' }),
    ],
  });
}

function modalLines(model: ScreenModel, modal: Modal, size: Size): Line[] {
  switch (modal.kind) {
    case 'help':
      return helpLines(size);
    case 'diagnostics':
      return diagnosticsLines(model, modal.scroll, size);
    case 'period':
      return periodLines(model, modal, size);
    case 'filters':
      return filterLines(model, modal, size);
  }
}

/** A screen of `size`, every line exactly as wide as the terminal. */
export function renderScreen(model: ScreenModel, size: Size, mono: boolean, basic = false): Line[] {
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
    return renderTooSmall(size);
  }

  const content = contentSize(size);
  const body = contentLines(model, content, { mono, basic }).slice(0, content.height);

  while (body.length < content.height) {
    body.push([]);
  }

  return [
    ...headerLines(model, size.width),
    ...body.map((line) => boxed(line, size.width)),
    footerLine(model.state, size.width),
  ];
}

export function renderTooSmall(size: Size): Line[] {
  const message = `llm-usage needs ${MIN_WIDTH}×${MIN_HEIGHT}; this terminal is ${size.width}×${size.height}. Enlarge it, or press q.`;
  return wrapWords(message, Math.max(10, size.width)).map((text) => [seg(text, { fg: 'notice' })]);
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** The screen while sessions are read: a box with a spinner and what is happening. */
export function renderLoading(size: Size, frameIndex: number, message: string): Line[] {
  const width = Math.max(20, Math.min(size.width, 72));
  const spinner = SPINNER[frameIndex % SPINNER.length];

  return frame(
    [[seg(`${spinner} `, { fg: 'accent' }), seg(message)], [seg('q quits', { fg: 'muted' })]],
    width,
    { title: 'llm-usage', rounded: true, active: true },
  );
}

/** The screen when the report could not be built. */
export function renderLoadError(size: Size, error: string): Line[] {
  const width = Math.max(20, Math.min(size.width, 100));

  return frame(
    [
      ...wrapWords(error, width - 4).map((text) => [seg(text, { fg: 'notice' })]),
      [seg('')],
      [seg('R retries · q quits', { fg: 'muted' })],
    ],
    width,
    { title: 'Could not read usage', rounded: true, active: true },
  );
}
