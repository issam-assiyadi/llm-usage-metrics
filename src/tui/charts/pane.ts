// What every chart pane shares: the cursor it moves, the input it draws from, and the words
// around the drawing (legend, readout, notes and the chart's table in focus mode).

import type { ChartTable } from '../../share-report/client/ui/charts/svg.js';
import type { ShareViewContext } from '../../share-report/client/ui/state/context.js';
import { visibleWidth } from '../../render/table-text-layout.js';
import { seg, wrapWords, type Line, type Segment, type Tone } from '../view/line.js';
import { renderTextTable } from '../view/text-table.js';

/** Where the keyboard is inside a pane: `x` a period or hour, `y` a row. */
export type Cursor = { x: number; y: number };

/** How far the cursor can move in a pane; 0 leaves that axis unused. */
export type PaneShape = {
  columns: number;
  rows: number;
  /** Where the first move lands on the rows: the last (latest day) or the first. */
  startRow?: 'first' | 'last';
};

export type PaneInput = {
  context: ShareViewContext;
  width: number;
  /** Rows the pane body may use. */
  height: number;
  /** Null until the pane has the keyboard. */
  cursor: Cursor | null;
  mono: boolean;
  /** 16 colours: heat levels add glyphs, since four reds do not read apart. */
  basicColor?: boolean;
  /** Focus mode: the pane fills the screen and shows its notes and table. */
  focus: boolean;
};

export type TuiPane = {
  /** The share report's chart id, so both name a chart alike. */
  id: string;
  title: string;
  shape: (context: ShareViewContext, focus: boolean) => PaneShape;
  render: (input: PaneInput) => Line[];
};

export type LegendItem = { label: string; value: string; tone: Tone; glyph: string };

/** Legend entries in rows that fit the width: `█ label value`. */
export function legendLines(items: readonly LegendItem[], width: number, mono: boolean): Line[] {
  const lines: Line[] = [];
  let line: Segment[] = [];
  let used = 0;

  for (const item of items) {
    const text = `${item.label} ${item.value}`.trim();
    const itemWidth = 2 + visibleWidth(text);

    if (used > 0 && used + 2 + itemWidth > width) {
      lines.push(line);
      line = [];
      used = 0;
    }

    if (used > 0) {
      line.push(seg('  '));
      used += 2;
    }

    line.push(seg(`${item.glyph} `, mono ? undefined : { fg: item.tone }));
    line.push(seg(text));
    used += itemWidth;
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines;
}

/** A message in place of a drawing, then the notes. */
export function messageLines(message: string, notes: readonly string[], width: number): Line[] {
  return [
    ...wrapWords(message, width).map((text) => [seg(text, { fg: 'muted' })]),
    ...noteLines(notes, width),
  ];
}

export function noteLines(notes: readonly string[], width: number): Line[] {
  return notes.flatMap((note) =>
    wrapWords(note, width - 2).map((text, index) => [
      seg(index === 0 ? '• ' : '  ', { fg: 'muted' }),
      seg(text, { dim: true }),
    ]),
  );
}

/**
 * Focus mode's lower half: the notes, then the chart's table from `offset`, as many rows as
 * fit in `height`.
 */
export function focusDetail(
  notes: readonly string[],
  table: ChartTable | undefined,
  width: number,
  height: number,
  offset: number,
): Line[] {
  const lines = noteLines(notes, width);

  if (table !== undefined && table.rows.length > 0) {
    const room = Math.max(1, height - lines.length - 3 - (table.total ? 2 : 0));
    const start = Math.min(Math.max(0, offset), Math.max(0, table.rows.length - room));
    const rows = table.rows.slice(start, start + room);
    lines.push([seg('')]);
    lines.push([
      seg(table.caption, { fg: 'muted' }),
      seg(
        table.rows.length > room
          ? `  rows ${start + 1}–${start + rows.length} of ${table.rows.length} (↑/↓)`
          : '',
        { dim: true },
      ),
    ]);
    lines.push(
      ...renderTextTable({
        columns: table.columns.map((column, index) => ({
          label: column.label,
          numeric: column.numeric,
          keep: index < 2,
        })),
        rows,
        foot: table.total ? [table.total] : undefined,
        width,
      }),
    );
  }

  return lines.slice(0, Math.max(0, height));
}

/** Clamps a cursor into a shape; null stays null. */
export function clampCursor(cursor: Cursor | null, shape: PaneShape): Cursor | null {
  if (cursor === null) {
    return null;
  }

  return {
    x: shape.columns === 0 ? 0 : Math.min(Math.max(0, cursor.x), shape.columns - 1),
    y: shape.rows === 0 ? 0 : Math.min(Math.max(0, cursor.y), shape.rows - 1),
  };
}
