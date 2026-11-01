import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DiagnosticsStore, stripAnsiCodes } from '../../src/tui/diagnostics.js';
import { decodeSharePayload } from '../../src/tui/load-report.js';
import {
  exportView,
  getSavedViewPath,
  readSavedView,
  writeSavedView,
} from '../../src/tui/session-files.js';
import { resolveColorLevel, resolveTone } from '../../src/tui/theme.js';
import { readFixturePayload } from '../share-report/client/core/share-fixture.js';

describe('theme', () => {
  it('picks the colour level from the environment', () => {
    expect(resolveColorLevel({ NO_COLOR: '1' })).toBe(0);
    expect(resolveColorLevel({ FORCE_COLOR: '0' })).toBe(0);
    expect(resolveColorLevel({ COLORTERM: 'truecolor' })).toBe(3);
    expect(resolveColorLevel({})).toBe(1);
    expect(resolveTone('accent', 3)).toBe('#df7b52');
    expect(resolveTone('series-1', 1)).toBe('cyan');
    expect(resolveTone('accent', 0)).toBeUndefined();
    expect(resolveTone(undefined, 3)).toBeUndefined();
  });
});

describe('DiagnosticsStore', () => {
  it('collects messages without colour codes and counts warnings', () => {
    const store = new DiagnosticsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.add('warn', '\u001b[33mprices\u001b[39m');
    store.add('info', 'scanned');
    store.add('stderr', '   ');
    unsubscribe();
    store.add('stderr', 'raw');

    expect(store.list().map((message) => message.text)).toEqual(['prices', 'scanned', 'raw']);
    expect(store.warningCount()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stripAnsiCodes('\u001b[1mx\u001b[22m')).toBe('x');
  });
});

describe('session files', () => {
  it('keeps the last view and ignores a file that is not one', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tui-view-'));
    const file = path.join(dir, 'nested', 'tui-view.json');
    const saved = {
      view: {
        hash: 'g=day',
        labels: { source: [], model: [], project: ['api'], machine: [] },
        drill: null,
      },
      hideNames: true,
      tab: 'projects' as const,
    };

    expect(await readSavedView(file)).toBeUndefined();
    await writeSavedView(file, saved);
    expect(await readSavedView(file)).toEqual(saved);

    await writeFile(file, '{', 'utf8');
    expect(await readSavedView(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ version: 2, ...saved }), 'utf8');
    expect(await readSavedView(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ version: 1, ...saved, tab: 'nope' }), 'utf8');
    expect((await readSavedView(file))?.tab).toBe('overview');
    expect(getSavedViewPath()).toContain('tui-view.json');
  });

  it('exports the view as the share report and opens it', async () => {
    const written: { name: string; html: string }[] = [];
    const open = vi.fn(() => Promise.resolve());
    const filePath = await exportView(readFixturePayload().data, 'g=month', {
      write: (name, html) => {
        written.push({ name, html });
        return Promise.resolve(`/tmp/${name}`);
      },
      open,
    });

    expect(filePath).toBe('/tmp/summary-share-view.html');
    expect(written[0].html).toContain('id="view-state"');
    expect(written[0].html).toContain('g=month');
    expect(open).toHaveBeenCalledWith('/tmp/summary-share-view.html');
  });
});

describe('decodeSharePayload', () => {
  it('decodes a payload and refuses a broken one', () => {
    const { data } = readFixturePayload();

    expect(decodeSharePayload(data).cellCount).toBeGreaterThan(0);
    expect(() => decodeSharePayload({ ...data, cube: { ...data.cube, period: [] } })).toThrow(
      'could not be read back',
    );
  });
});
