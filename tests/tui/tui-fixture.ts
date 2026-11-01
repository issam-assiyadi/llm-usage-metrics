import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  getDefaultViewState,
  type ShareReport,
  type ShareViewState,
} from '../../src/share-report/client/core/index.js';
import {
  buildViewContext,
  createLabels,
  createMaskSource,
  type ShareViewContext,
} from '../../src/share-report/client/ui/state/context.js';
import type { ShareEmbeddedEnvelope, ShareReportData } from '../../src/share-report/types.js';
import { loadFixtureReport } from '../share-report/client/core/share-fixture.js';

export { loadFixtureReport };

export function fixtureContext(
  report: ShareReport = loadFixtureReport(),
  patch: Partial<ShareViewState> = {},
  hideNames = false,
): ShareViewContext {
  const view = { ...getDefaultViewState(report), ...patch };
  const labels = createLabels(report, hideNames ? createMaskSource(report)() : undefined);

  return buildViewContext(report, view, labels, 'dark');
}

/** The `data` of a committed report golden: the CLI's real `--json` output. */
export function readGolden(name: string): ShareEmbeddedEnvelope['data'] {
  const file = path.resolve('tests/golden/__goldens__/reports', `${name}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { data: ShareEmbeddedEnvelope['data'] }).data;
}

export function reportWithEnvelope(
  report: ShareEmbeddedEnvelope['report'],
  golden: string,
  edit?: (data: ShareReportData) => void,
): ShareReport {
  return loadFixtureReport((payload) => {
    payload.envelope = { schemaVersion: 1, report, data: readGolden(golden) };
    edit?.(payload);
  });
}
