// Tables in terminal columns: the share report's chart tables, panel tables and the project
// table all draw through here. The first column (the row's name) takes the room left after
// the others; when they do not fit, the columns marked droppable go first, from the right.

import { visibleWidth } from '../../render/table-text-layout.js';
import { cell, seg, type Line, type Style } from './line.js';

export type TextTableColumn = {
  label: string;
  numeric: boolean;
  /** False lets a narrow terminal leave the column out, as the share report does on phones. */
  keep?: boolean;
  /** `▲` or `▼` after the header: the column the rows sort by. */
  sort?: 'asc' | 'desc';
};

export type TextTableInput = {
  columns: readonly TextTableColumn[];
  rows: readonly (readonly string[])[];
  /** Total rows, drawn under a rule. */
  foot?: readonly (readonly string[])[];
  width: number;
  /** The row the keyboard is on, highlighted. */
  selected?: number | null;
};

const MIN_NAME_WIDTH = 10;
/** Columns the terminal may leave out go before the name gets narrower than this. */
const PREFERRED_NAME_WIDTH = 28;
const GAP = 2;

function headerText(column: TextTableColumn): string {
  return column.sort === undefined
    ? column.label
    : `${column.label} ${column.sort === 'asc' ? '▲' : '▼'}`;
}

/** The columns that fit, by index, and each one's width. */
export function fitColumns(
  input: Pick<TextTableInput, 'columns' | 'rows' | 'foot' | 'width'>,
): { index: number; width: number }[] {
  const all = [...input.rows, ...(input.foot ?? [])];
  const natural = input.columns.map((column, index) =>
    Math.max(visibleWidth(headerText(column)), ...all.map((row) => visibleWidth(row[index] ?? ''))),
  );
  const kept = input.columns.map((_, index) => index);
  const restWidth = () => kept.slice(1).reduce((sum, index) => sum + natural[index] + GAP, 0);

  const preferred = Math.min(natural[0] ?? 0, PREFERRED_NAME_WIDTH);
  const droppable = () =>
    [...kept].reverse().find((index) => index > 0 && input.columns[index].keep === false);

  // First the optional columns, while the name is narrower than it would like.
  for (
    let next = droppable();
    next !== undefined && restWidth() + preferred > input.width;
    next = droppable()
  ) {
    kept.splice(kept.indexOf(next), 1);
  }

  // Then, only when even a short name does not fit, the rightmost columns.
  while (kept.length > 1 && restWidth() + MIN_NAME_WIDTH > input.width) {
    kept.splice(kept.length - 1, 1);
  }

  const nameWidth = Math.max(
    Math.min(natural[0] ?? 0, input.width - restWidth()),
    Math.min(MIN_NAME_WIDTH, input.width),
  );

  return kept.map((index) => ({ index, width: index === 0 ? nameWidth : natural[index] }));
}

function rowLine(
  texts: readonly string[],
  columns: readonly TextTableColumn[],
  fitted: readonly { index: number; width: number }[],
  style?: Style,
): Line {
  const parts = fitted.map(({ index, width }) =>
    cell(texts[index] ?? '', width, columns[index].numeric ? 'right' : 'left'),
  );

  return [seg(parts.join(' '.repeat(GAP)), style)];
}

export function renderTextTable(input: TextTableInput): Line[] {
  const fitted = fitColumns(input);
  const used = fitted.reduce((sum, column) => sum + column.width, 0) + GAP * (fitted.length - 1);
  const headers = input.columns.map(headerText);
  const lines: Line[] = [rowLine(headers, input.columns, fitted, { fg: 'muted', bold: true })];

  for (const [index, row] of input.rows.entries()) {
    lines.push(
      rowLine(row, input.columns, fitted, index === input.selected ? { inverse: true } : undefined),
    );
  }

  if (input.foot !== undefined && input.foot.length > 0) {
    lines.push([seg('─'.repeat(Math.max(0, used)), { fg: 'rule' })]);

    for (const row of input.foot) {
      lines.push(rowLine(row, input.columns, fitted, { bold: true }));
    }
  }

  return lines;
}
