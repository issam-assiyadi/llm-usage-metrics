import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  isInteractiveTerminal,
  loadTuiModule,
  routeBareRunToTui,
  runTuiCommand,
  TUI_NEEDS_TERMINAL_MESSAGE,
} from '../../src/cli/run-tui-command.js';
import type { TuiDeps } from '../../src/tui/run-tui.js';
import { logger } from '../../src/utils/logger.js';

const tty = { stdin: { isTTY: true }, stdout: { isTTY: true } };

describe('isInteractiveTerminal', () => {
  it('needs a terminal on both stdin and stdout', () => {
    expect(isInteractiveTerminal(tty)).toBe(true);
    expect(isInteractiveTerminal({ stdin: { isTTY: true }, stdout: {} })).toBe(false);
    expect(isInteractiveTerminal({ stdin: {}, stdout: { isTTY: true } })).toBe(false);
  });
});

describe('runTuiCommand', () => {
  it('fails with an actionable message without a terminal', async () => {
    const loadModule = vi.fn();

    await expect(
      runTuiCommand({}, { streams: { stdin: {}, stdout: {} }, loadModule }),
    ).rejects.toThrow(TUI_NEEDS_TERMINAL_MESSAGE);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it('runs the TUI with the loader, keeps the view it returns and replays warnings', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tui-command-'));
    const savedViewPath = path.join(dir, 'tui-view.json');
    const saved = {
      view: { hash: '', labels: { source: [], model: [], project: [], machine: [] }, drill: null },
      hideNames: false,
      tab: 'rates' as const,
    };
    const written: string[] = [];
    const runTui = vi.fn((deps: TuiDeps) => {
      logger.warn('pricing fell back');
      expect(typeof deps.load).toBe('function');
      expect(typeof deps.exportView).toBe('function');
      return Promise.resolve(saved);
    });

    await runTuiCommand(
      { source: 'codex' },
      {
        streams: tty,
        loadModule: () => Promise.resolve({ runTui }),
        savedViewPath,
        writeStderr: (text) => written.push(text),
      },
    );

    expect(runTui).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(savedViewPath, 'utf8'))).toMatchObject({ tab: 'rates' });
    expect(written).toEqual(['⚠ pricing fell back\n']);
  });

  it('hands the TUI its loader and export, and writes warnings to stderr by default', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tui-command-'));
    const load = vi.fn(() => Promise.reject(new Error('not read')));
    const exportView = vi.fn(() => Promise.resolve('/tmp/x.html'));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runTui = vi.fn(async (deps: TuiDeps) => {
      await expect(deps.load()).rejects.toThrow('not read');
      await expect(deps.exportView({} as never, 'g=day')).resolves.toBe('/tmp/x.html');
      process.stderr.write('raw stderr line\n');
      return undefined;
    });

    await runTuiCommand(
      {},
      {
        streams: tty,
        loadModule: () => Promise.resolve({ runTui }),
        load,
        exportView,
        savedViewPath: path.join(dir, 'missing', 'view.json'),
      },
    );
    const calls = write.mock.calls.map(([chunk]) => String(chunk));
    write.mockRestore();

    expect(exportView).toHaveBeenCalledWith({}, 'g=day');
    expect(calls).toContain('⚠ raw stderr line\n');
  });

  it('loads the real TUI module lazily', async () => {
    const module = await loadTuiModule();

    expect(typeof module.runTui).toBe('function');
  });
});

describe('routeBareRunToTui', () => {
  const argv = ['node', 'llm-usage'];

  it('opens the TUI for a bare run in an interactive terminal', () => {
    expect(routeBareRunToTui(argv, {}, tty)).toEqual([...argv, 'tui']);
  });

  it('keeps the summary with arguments, without a terminal, in CI, on a dumb terminal or when opted out', () => {
    expect(routeBareRunToTui([...argv, '--since', '2026-10-01'], {}, tty)).toEqual([
      ...argv,
      '--since',
      '2026-10-01',
    ]);
    expect(routeBareRunToTui(argv, {}, { stdin: { isTTY: true }, stdout: {} })).toEqual(argv);
    expect(routeBareRunToTui(argv, { CI: 'true' }, tty)).toEqual(argv);
    expect(routeBareRunToTui(argv, { TERM: 'dumb' }, tty)).toEqual(argv);
    expect(routeBareRunToTui(argv, { LLM_USAGE_NO_TUI: '1' }, tty)).toEqual(argv);
    expect(routeBareRunToTui(argv, { LLM_USAGE_NO_TUI: '0', CI: '' }, tty)).toEqual([
      ...argv,
      'tui',
    ]);
  });
});
