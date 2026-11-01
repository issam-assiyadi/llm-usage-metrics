// What the TUI keeps between runs and writes on request: the last view (as the page keeps its
// view in the URL), and the current view exported as the interactive HTML report.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { openShareFile, writeShareFile } from '../cli/share-artifact.js';
import { SUMMARY_SHARE_FILE_BASE_NAME } from '../cli/run-summary-report.js';
import { renderShareHtml } from '../share-report/render-share-html.js';
import type { ShareReportData } from '../share-report/types.js';
import { getUserCacheRootDir } from '../utils/cache-root-dir.js';
import { asRecord } from '../../packages/core/src/utils/as-record.js';
import { parsePortableView, type PortableView } from './state/portable-view.js';
import { TAB_IDS, type TabId } from './state/tui-state.js';

export type SavedTuiView = {
  view: PortableView;
  hideNames: boolean;
  tab: TabId;
};

export function getSavedViewPath(): string {
  return path.join(getUserCacheRootDir(), 'llm-usage-metrics', 'tui-view.json');
}

function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && TAB_IDS.some((tab) => tab === value);
}

/** The view saved by the last run, or undefined when there is none or it does not parse. */
export async function readSavedView(filePath: string): Promise<SavedTuiView | undefined> {
  let text: string;

  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  const record = asRecord(parsed);
  const view = parsePortableView(record?.view);

  if (record === undefined || view === undefined || record.version !== 1) {
    return undefined;
  }

  return {
    view,
    hideNames: record.hideNames === true,
    tab: isTabId(record.tab) ? record.tab : 'overview',
  };
}

export async function writeSavedView(filePath: string, saved: SavedTuiView): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ version: 1, ...saved }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export type ExportDeps = {
  write?: (fileName: string, content: string) => Promise<string>;
  open?: (filePath: string) => Promise<void>;
};

/**
 * Writes the report as the HTML file `--share` makes, opening on `viewHash`, to the current
 * directory, and opens it. Returns the file's path.
 */
export async function exportView(
  data: ShareReportData,
  viewHash: string,
  deps: ExportDeps = {},
): Promise<string> {
  const fileBaseName = SUMMARY_SHARE_FILE_BASE_NAME;
  const html = renderShareHtml({ data, fileBaseName, savedViewHash: viewHash });
  const filePath = await (deps.write ?? writeShareFile)(`${fileBaseName}-view.html`, html);
  await (deps.open ?? openShareFile)(filePath);

  return filePath;
}
