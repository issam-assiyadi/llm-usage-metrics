import { describe, expect, it } from 'vitest';

import { loadTuiReport } from '../../src/tui/load-report.js';
import { createCorpusAdapters, generateShareCorpus } from '../helpers/share-payload.js';
import { useIsolatedEnvironment } from '../helpers/isolated-env.js';
import { useBundledPricingOnly } from '../helpers/offline-pricing.js';

describe('loadTuiReport', () => {
  useIsolatedEnvironment();
  useBundledPricingOnly();

  it('reads the summary share report and decodes it as the page would', async () => {
    const events = generateShareCorpus(7, 12);
    const loaded = await loadTuiReport(
      { timezone: 'UTC', pricingOffline: true, sync: false },
      {
        now: () => new Date(events[events.length - 1].timestamp),
        createAdapters: createCorpusAdapters(events),
        getEventStoreRuntimeConfig: () => ({
          enabled: false,
          path: '',
          disabledBy: 'configuration',
        }),
      },
    );

    expect(loaded.report.data.meta.command).toBe('summary');
    expect(loaded.report.data.envelope?.report).toBe('summary');
    expect(loaded.report.data.meta.initialView.granularity).toBe('week');
    expect(loaded.report.cellCount).toBeGreaterThan(0);
    expect(loaded.data).toBe(loaded.report.data);
  });
});
