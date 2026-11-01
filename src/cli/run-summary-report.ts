import {
  renderSummaryReport,
  renderSummaryReportWithNotes,
  type SummaryReportFormat,
} from '../render/render-summary-report.js';
import { buildSummaryData } from './build-summary-data.js';
import type { ShareReportRequest } from './build-share-report-data.js';
import {
  prepareReport,
  runStandardPreparedReport,
  STANDARD_REPORT_FORMATS,
} from './report-runtime/report-lifecycle.js';
import { createRuntimeProfileCollector } from './runtime-profile.js';
import type {
  BuildSummaryDataDeps,
  SummaryCommandOptions,
  SummaryDataResult,
} from './usage-data-contracts.js';
import { hasCliFilters } from './filter-match-warnings.js';
import { buildShareReportArtifact, parseReportJsonEnvelope } from './share-report-artifact.js';

const summaryReportFormats = STANDARD_REPORT_FORMATS satisfies readonly SummaryReportFormat[];

export const SUMMARY_NEXT_STEPS_HINT =
  'More detail: llm-usage daily · llm-usage monthly · llm-usage compare · llm-usage --help';

/** The share file's name without extension; a saved view adds `-view`. */
export const SUMMARY_SHARE_FILE_BASE_NAME = 'summary-share';

/**
 * The share report of a summary: `--share` writes it as a file and the TUI draws it. The page
 * holds the activity grid's 53 weeks and opens on all of them, by week.
 */
export function buildSummaryShareRequest(
  summaryData: SummaryDataResult,
  options: SummaryCommandOptions,
): ShareReportRequest {
  const window = { since: summaryData.activity.from, until: summaryData.activity.to };

  return {
    command: 'summary',
    options,
    window,
    initialView: { ...window, granularity: 'week' },
    envelope: parseReportJsonEnvelope(renderSummaryReport(summaryData, 'json')),
  };
}

async function prepareSummaryReport(
  options: SummaryCommandOptions,
  deps: BuildSummaryDataDeps = {},
) {
  return prepareReport({
    commandOptions: options,
    supportedFormats: summaryReportFormats,
    buildData: () => buildSummaryData(options, deps),
    getDiagnostics: (summaryData) => summaryData.diagnostics,
    runtimeProfile: deps.runtimeProfile,
    buildShare: async (summaryData, { runtimeProfile }) =>
      buildShareReportArtifact(
        {
          ...buildSummaryShareRequest(summaryData, options),
          fileBaseName: SUMMARY_SHARE_FILE_BASE_NAME,
          logLabel: 'summary',
        },
        { ...deps, runtimeProfile },
      ),
    render: (summaryData, format) => {
      const { output, notes } = renderSummaryReportWithNotes(summaryData, format, {
        filtered: hasCliFilters(options),
      });

      return { output, hintsAfterOutput: notes };
    },
    getHintsAfterOutput: (_summaryData, format) =>
      format === 'terminal' ? [SUMMARY_NEXT_STEPS_HINT] : [],
  });
}

export async function buildSummaryReport(
  options: SummaryCommandOptions,
  deps: BuildSummaryDataDeps = {},
): Promise<string> {
  const preparedReport = await prepareSummaryReport(options, deps);
  return preparedReport.output;
}

export async function runSummaryReport(options: SummaryCommandOptions): Promise<void> {
  const runtimeProfile = createRuntimeProfileCollector();
  const preparedReport = await prepareSummaryReport(options, { runtimeProfile });

  await runStandardPreparedReport({ preparedReport });
}
