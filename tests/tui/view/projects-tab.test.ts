import { describe, expect, it } from 'vitest';

import type { TableView } from '../../../src/share-report/client/ui/tables/model.js';
import { getTableView, renderProjectsTab } from '../../../src/tui/view/projects-tab.js';
import { linesText } from '../../../src/tui/view/line.js';
import { fixtureContext } from '../tui-fixture.js';

function table(overrides: Partial<TableView> = {}): TableView {
  return {
    kind: 'projects',
    caption: 'Projects',
    columns: [
      {
        key: 'label',
        label: 'Project',
        numeric: false,
        sortKey: 'label',
        narrow: true,
        sort: 'ascending',
      },
      {
        key: 'totalTokens',
        label: 'Tokens',
        numeric: true,
        sortKey: 'totalTokens',
        narrow: true,
        sort: 'none',
      },
      {
        key: 'cost',
        label: 'Cost',
        numeric: true,
        sortKey: 'cost',
        narrow: false,
        sort: 'descending',
      },
    ],
    rows: Array.from({ length: 20 }, (_, index) => ({
      key: String(index),
      cells: [
        { text: `p${index}` },
        { text: String(index) },
        { text: '$1', note: index === 0 ? 'lower bound' : undefined },
      ],
      drill: index,
    })),
    total: [{ text: 'All' }, { text: '190' }, { text: '$20' }],
    page: 0,
    pageCount: 1,
    rowCount: 20,
    empty: 'No projects',
    omittedSessions: 0,
    ...overrides,
  };
}

describe('renderProjectsTab', () => {
  it('keeps the header and totals and scrolls the rows to the selection', () => {
    const text = linesText(renderProjectsTab(table(), 15, 60, 12));

    expect(text).toContain('Project ▲');
    expect(text).toContain('Cost ▼');
    expect(text).toContain('p15');
    expect(text).not.toContain('p0 ');
    expect(text).toContain('All');
  });

  it('shows every row when they fit, marking lower bounds', () => {
    expect(linesText(renderProjectsTab(table(), null, 60, 40))).toContain('$1*');
  });

  it('shows the empty message and the omitted sessions note', () => {
    expect(linesText(renderProjectsTab(table({ rows: [], rowCount: 0 }), null, 60, 10))).toContain(
      'No projects',
    );
    const sessions = table({
      kind: 'sessions',
      total: undefined,
      omittedSessions: 3,
      rows: table().rows.slice(0, 2),
    });
    const text = linesText(renderProjectsTab(sessions, 0, 60, 20));

    expect(text).toContain('◂ Esc');
    expect(text).toContain('3 older sessions');
  });

  it('builds the table from the view', () => {
    expect(getTableView(fixtureContext(), 0).kind).toBe('projects');
  });
});
