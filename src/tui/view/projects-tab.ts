// The Projects tab: the share report's project table and its session drill-down, sorted and
// paged by the same models; Enter opens a project's sessions, Esc goes back.

import {
  buildTable,
  describeOmittedSessions,
  describePage,
  type TableView,
} from '../../share-report/client/ui/tables/model.js';
import type { ShareViewContext } from '../../share-report/client/ui/state/context.js';
import { seg, wrapWords, type Line } from './line.js';
import { renderTextTable } from './text-table.js';

export function getTableView(context: ShareViewContext, page: number): TableView {
  return buildTable(context, page);
}

export function renderProjectsTab(
  table: TableView,
  selected: number | null,
  width: number,
  height: number,
): Line[] {
  const head: Line[] = [
    [
      seg(table.kind === 'sessions' ? '◂ Esc  ' : '', { fg: 'accent' }),
      seg(table.caption, { bold: true }),
    ],
    [
      seg(
        `${describePage(table)} · page ${table.page + 1}/${Math.max(1, table.pageCount)} · o sort · O reverse · PgUp/PgDn page${table.kind === 'projects' ? ' · Enter sessions' : ''}`,
        { fg: 'muted' },
      ),
    ],
  ];

  if (table.rows.length === 0) {
    return [...head, [seg(table.empty, { fg: 'muted' })]];
  }

  const omitted = describeOmittedSessions(table.omittedSessions);
  const tail: Line[] =
    omitted === undefined
      ? []
      : wrapWords(omitted, width).map((text) => [seg(text, { dim: true })]);
  const body = renderTextTable({
    columns: table.columns.map((column, index) => ({
      label: column.label,
      numeric: column.numeric,
      keep: index === 0 || column.narrow,
      sort: column.sort === 'ascending' ? 'asc' : column.sort === 'descending' ? 'desc' : undefined,
    })),
    rows: table.rows.map((row) =>
      row.cells.map((entry) => (entry.note ? `${entry.text}*` : entry.text)),
    ),
    foot: table.total ? [table.total.map((entry) => entry.text)] : undefined,
    width,
    selected,
  });
  // The header stays; the rows scroll to keep the selection in view.
  const room = Math.max(2, height - head.length - tail.length);
  const rowRoom = room - 1 - (table.total ? 2 : 0);
  const rowCount = table.rows.length;

  if (rowCount <= rowRoom) {
    return [...head, ...body, ...tail];
  }

  const start = Math.min(
    rowCount - rowRoom,
    Math.max(0, (selected ?? 0) - Math.floor(rowRoom / 2)),
  );

  return [
    ...head,
    body[0],
    ...body.slice(1 + start, 1 + start + rowRoom),
    ...body.slice(1 + rowCount),
    ...tail,
  ];
}
