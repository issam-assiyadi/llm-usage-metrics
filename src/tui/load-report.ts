// The data behind the TUI: the summary's share report, read the way `llm-usage --share` reads
// it, then decoded by the share report's own decoder so the terminal works on exactly the
// payload the browser would.

import { buildSummaryData } from '../cli/build-summary-data.js';
import { buildShareReportData } from '../cli/build-share-report-data.js';
import { emitDiagnostics } from '../cli/emit-diagnostics.js';
import { buildSummaryShareRequest } from '../cli/run-summary-report.js';
import type { BuildSummaryDataDeps, TuiCommandOptions } from '../cli/usage-data-contracts.js';
import { decodeShareReport, type ShareReport } from '../share-report/client/core/index.js';
import type { ShareReportData } from '../share-report/types.js';

export type LoadedReport = {
  report: ShareReport;
  /** The payload as built, for exporting the view as an HTML report. */
  data: ShareReportData;
};

/** Wraps a payload as the page embeds it and decodes it; throws when it does not decode. */
export function decodeSharePayload(data: ShareReportData): ShareReport {
  const decoded = decodeShareReport({ schemaVersion: 1, report: 'share', data });

  if (!decoded.ok) {
    throw new Error(`The usage report could not be read back: ${decoded.error}`);
  }

  return decoded.report;
}

/**
 * Reads usage for the TUI. Diagnostics go through the logger, which the TUI points at its
 * warnings drawer while it owns the screen.
 */
export async function loadTuiReport(
  options: TuiCommandOptions,
  deps: BuildSummaryDataDeps = {},
): Promise<LoadedReport> {
  const summary = await buildSummaryData(options, deps);
  emitDiagnostics(summary.diagnostics);
  const data = await buildShareReportData(buildSummaryShareRequest(summary, options), deps);

  return { report: decodeSharePayload(data), data };
}
