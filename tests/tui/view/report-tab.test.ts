import { describe, expect, it } from 'vitest';

import { createLabels } from '../../../src/share-report/client/ui/state/context.js';
import { renderReportTab } from '../../../src/tui/view/report-tab.js';
import { linesText, lineWidth } from '../../../src/tui/view/line.js';
import { loadFixtureReport, reportWithEnvelope } from '../tui-fixture.js';

function draw(report = loadFixtureReport(), mono = false): string {
  const lines = renderReportTab(report, createLabels(report, undefined), 100, mono);
  expect(lines.every((line) => lineWidth(line) <= 100)).toBe(true);
  return linesText(lines);
}

describe('renderReportTab', () => {
  it('says when the report embeds no panel', () => {
    expect(draw()).toContain('embeds no command summary');
  });

  it.each([
    ['summary', 'summary', 'This month and the past year'],
    ['trends', 'trends-tokens', 'The trend'],
    ['compare', 'compare', 'Current against baseline'],
    ['efficiency', 'efficiency-monthly', 'Cost against commits'],
    ['optimize', 'optimize-monthly', 'Candidate models'],
  ] as const)('draws the %s panel', (kind, golden, title) => {
    const text = draw(reportWithEnvelope(kind, golden));

    expect(text).toContain(title);
    expect(text.split('\n').length).toBeGreaterThan(5);
  });

  it('draws the year in review with its calendar and top lists, also without colour', () => {
    const report = reportWithEnvelope('wrapped', 'wrapped', (data) => {
      data.meta.window = { since: '2026-01-01', until: '2026-12-31' };
    });

    expect(draw(report)).toContain('Year in review');
    expect(draw(report, true)).toContain('Year in review');
  });
});
