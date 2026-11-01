// Building blocks the screens share: stat cards (the summary figures and panel facts), styled
// prose that wraps, panel tables and the daily calendar.

import type { CalendarView } from '../../share-report/client/ui/panels/calendar-model.js';
import type { LedePart, PanelFact, PanelTable } from '../../share-report/client/ui/panels/model.js';
import { visibleWidth } from '../../render/table-text-layout.js';
import {
  besides,
  frame,
  seg,
  shorten,
  type Line,
  type Segment,
  type Style,
  type Tone,
  wrapWords,
} from './line.js';
import { renderTextTable } from './text-table.js';

export type StatCard = { label: string; value: string; detail?: string };

/**
 * Cards in rows that fit `width`: the label in the border, the value bold, the detail under it
 * when `details` is on. Cards on a row share its height.
 */
export function statCards(cards: readonly StatCard[], width: number, details: boolean): Line[] {
  const sized = cards.map((card) => {
    const body = details && card.detail ? [card.value, card.detail] : [card.value];
    const natural = Math.max(
      visibleWidth(card.label) + 6,
      ...body.map((text) => visibleWidth(text) + 4),
    );
    return { card, width: Math.min(natural, width) };
  });
  const rows: (typeof sized)[] = [];
  let row: typeof sized = [];
  let used = 0;

  for (const entry of sized) {
    if (row.length > 0 && used + 1 + entry.width > width) {
      rows.push(row);
      row = [];
      used = 0;
    }

    row.push(entry);
    used += (row.length > 1 ? 1 : 0) + entry.width;
  }

  if (row.length > 0) {
    rows.push(row);
  }

  return rows.flatMap((natural) => {
    // The row's spare columns go to its cards, so a row of cards spans the screen.
    const spare =
      width - natural.reduce((sum, entry) => sum + entry.width, 0) - (natural.length - 1);
    const cardsInRow = natural.map((entry, index) => ({
      ...entry,
      width:
        entry.width + Math.floor(spare / natural.length) + (index < spare % natural.length ? 1 : 0),
    }));

    return besides(
      cardsInRow.map(({ card, width: cardWidth }) => ({
        width: cardWidth,
        lines: frame(
          [
            [seg(shorten(card.value, cardWidth - 4), { bold: true, fg: 'ink' })],
            ...(details && card.detail
              ? [[seg(shorten(card.detail, cardWidth - 4), { fg: 'muted' })]]
              : []),
          ],
          cardWidth,
          { title: card.label },
        ),
      })),
    );
  });
}

export type StyledPart = { text: string; style?: Style };

/** Styled prose wrapped at spaces; each word keeps its part's style. */
export function wrapParts(parts: readonly StyledPart[], width: number): Line[] {
  const lines: Line[] = [];
  let line: Segment[] = [];
  let used = 0;

  for (const part of parts) {
    for (const word of part.text.split(/(\s+)/u)) {
      if (word === '') {
        continue;
      }

      const isSpace = /^\s+$/u.test(word);
      const wordWidth = isSpace ? 1 : visibleWidth(word);

      if (isSpace) {
        if (used > 0 && used < width) {
          line.push(seg(' '));
          used += 1;
        }

        continue;
      }

      if (used > 0 && used + wordWidth > width) {
        lines.push(trimEnd(line));
        line = [];
        used = 0;
      }

      line.push(seg(shorten(word, width), part.style));
      used += Math.min(wordWidth, width);
    }
  }

  if (line.length > 0) {
    lines.push(trimEnd(line));
  }

  return lines;
}

function trimEnd(line: Segment[]): Segment[] {
  const last = line.at(-1);
  return last?.text === ' ' ? line.slice(0, -1) : line;
}

/** A lede: figures in bold accent, the words between them plain. */
export function ledeLines(parts: readonly LedePart[], width: number): Line[] {
  return wrapParts(
    parts.map((part) => ({
      text: part.text,
      style: part.figure ? { bold: true, fg: 'accent' as const } : undefined,
    })),
    width,
  );
}

export function factCards(facts: readonly PanelFact[], width: number): Line[] {
  return statCards(
    facts.map((fact) => ({ label: fact.label, value: fact.value, detail: fact.detail })),
    width,
    true,
  );
}

/** A panel table: its title, its caption, then the rows and the totals under a rule. */
export function panelTableLines(table: PanelTable, width: number): Line[] {
  const text = (cells: PanelTable['rows'][number]) =>
    cells.map((entry) => (entry.note === undefined ? entry.text : `${entry.text}*`));
  const notes = [...table.rows, ...table.foot].flat().some((entry) => entry.note !== undefined);

  return [
    [seg(table.title, { bold: true })],
    ...(table.caption
      ? wrapWords(table.caption, width).map((text) => [seg(text, { fg: 'muted' })])
      : []),
    ...renderTextTable({
      columns: table.columns.map((column, index) => ({
        label: column.label,
        numeric: column.numeric,
        keep: index === 0 || column.narrow !== false,
      })),
      rows: table.rows.map(text),
      foot: table.foot.map(text),
      width,
    }),
    ...(notes ? [[seg('* a lower bound: some events had no price', { dim: true })]] : []),
  ];
}

const HEAT_TONES = [
  'heat-0',
  'heat-1',
  'heat-2',
  'heat-3',
  'heat-4',
] as const satisfies readonly Tone[];
const HEAT_GLYPHS = ['·', '░', '▒', '▓', '█'] as const;

/**
 * The daily calendar: weekdays down, weeks across, one cell per day at its heat level. When
 * the weeks do not fit, the latest ones show.
 */
export function calendarLines(
  calendar: CalendarView,
  width: number,
  mono: boolean,
  basic = false,
): Line[] {
  const labelWidth = 4;
  const fit = Math.max(1, Math.min(calendar.weeks, width - labelWidth));
  const firstWeek = calendar.weeks - fit;
  const grid = Array.from({ length: 7 }, () => new Array<number | undefined>(fit).fill(undefined));

  for (const day of calendar.days) {
    if (day.week >= firstWeek) {
      grid[day.weekday][day.week - firstWeek] = day.level;
    }
  }

  const monthRow = new Array<string>(fit).fill(' ');

  for (const month of calendar.months) {
    const at = month.week - firstWeek;

    if (
      at >= 0 &&
      at + month.label.length <= fit &&
      monthRow.slice(at, at + month.label.length + 1).every((c) => c === ' ')
    ) {
      for (let offset = 0; offset < month.label.length; offset += 1) {
        monthRow[at + offset] = month.label.charAt(offset);
      }
    }
  }

  return [
    [seg(' '.repeat(labelWidth) + monthRow.join(''), { fg: 'muted' })],
    ...grid.map((week, weekday) => [
      seg((weekday % 2 === 0 ? calendar.weekdays[weekday] : '').padEnd(labelWidth), {
        fg: 'muted',
      }),
      ...week.map((level) =>
        level === undefined
          ? seg(' ')
          : seg(
              mono || basic || level === 0 ? HEAT_GLYPHS[level] : '■',
              mono ? undefined : { fg: level === 0 ? 'rule' : HEAT_TONES[level] },
            ),
      ),
    ]),
    [seg(shorten(calendar.summary, width), { dim: true })],
  ];
}
