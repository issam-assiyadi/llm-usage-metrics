// The panel slot. Each command with its own report registers a lead here; the shell gives
// every panel that applies to the file a titled section above the controls, in list order,
// and calls `render` again whenever the view changes. The page opens on what its command is
// about; the controls and charts below are for digging in.
//
// A panel's contract:
// - `appliesTo` decides from the report alone, e.g. by `report.data.envelope?.report`.
// - `render` replaces the content of `body` from the context alone and shows project and
//   machine names through `context.labels` ("Hide names").
// - Styling through classes only (the CSP allows no `style` attribute).

import type { ShareReport } from '../../core/index.js';
import type { ShareViewContext } from '../state/context.js';
import { embeds, SHARE_PANEL_HEADINGS, type SharePanelId } from './model.js';
import {
  renderComparePanel,
  renderEfficiencyPanel,
  renderOptimizePanel,
  renderSummaryPanel,
  renderTrendsPanel,
  renderWrappedPanel,
} from './render.js';

export type SharePanel = {
  /** Stable and URL-safe: names the section's element id. */
  id: string;
  title: string;
  appliesTo: (report: ShareReport) => boolean;
  render: (body: HTMLElement, context: ShareViewContext) => void;
};

const RENDERERS: Record<SharePanelId, SharePanel['render']> = {
  'wrapped-recap': renderWrappedPanel,
  summary: renderSummaryPanel,
  trends: renderTrendsPanel,
  compare: renderComparePanel,
  efficiency: renderEfficiencyPanel,
  optimize: renderOptimizePanel,
};

export const SHARE_PANELS: readonly SharePanel[] = SHARE_PANEL_HEADINGS.map((heading) => ({
  id: heading.id,
  title: heading.title,
  appliesTo: embeds(heading.report),
  render: RENDERERS[heading.id],
}));
