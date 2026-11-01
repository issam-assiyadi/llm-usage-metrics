import { PassThrough } from 'node:stream';

import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { decodeSharePayload, type LoadedReport } from '../../src/tui/load-report.js';
import { App, type AppProps } from '../../src/tui/app.js';
import { DiagnosticsStore } from '../../src/tui/diagnostics.js';
import { captureStderr, replayWarnings } from '../../src/tui/capture-stderr.js';
import { mountTui, runTui } from '../../src/tui/run-tui.js';
import { logger } from '../../src/utils/logger.js';
import { readFixturePayload } from '../share-report/client/core/share-fixture.js';

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function loaded(): LoadedReport {
  const { data } = readFixturePayload();
  return { report: decodeSharePayload(data), data };
}

function createTerminal() {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  let output = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });

  return {
    streams: {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
    },
    output: () => output,
    press: async (key: string) => {
      stdin.write(key);
      await tick();
    },
  };
}

function props(overrides: Partial<AppProps> = {}): AppProps {
  return {
    load: () => Promise.resolve(loaded()),
    colorLevel: 3,
    diagnostics: new DiagnosticsStore(),
    exportView: () => Promise.resolve('/tmp/view.html'),
    onQuit: vi.fn(),
    // ink-testing-library draws 100 columns.
    size: { width: 100, height: 40 },
    ...overrides,
  };
}

describe('App', () => {
  it('shows a loading screen, then the report, and walks tabs, focus and dialogs', async () => {
    const view = render(<App {...props()} />);

    expect(view.lastFrame()).toContain('Reading your sessions');
    await tick(80);
    expect(view.lastFrame()).toContain('Cost over time');

    for (const key of [
      '\u001b[C',
      '\r',
      '\u001b',
      '2',
      '\t',
      '3',
      '4',
      '5',
      '6',
      '1',
      'g',
      'c',
      's',
      'h',
      'x',
      'r',
      'f',
      ' ',
      '\u001b',
      'p',
      '\u001b',
      '?',
      '\u001b',
      'd',
      '\u001b',
    ]) {
      view.stdin.write(key);
      await tick(15);
    }

    expect(view.lastFrame()).toContain('llm-usage');
    view.unmount();
  });

  it('exports the view and reports where the file went', async () => {
    const exportView = vi.fn(() => Promise.resolve('/tmp/view.html'));
    const view = render(<App {...props({ exportView })} />);
    await tick(80);
    view.stdin.write('e');
    await tick(80);

    expect(exportView).toHaveBeenCalled();
    expect(view.lastFrame()).toContain('Opened /tmp/view.html');
    view.unmount();
  });

  it('says when an export fails', async () => {
    const view = render(
      <App {...props({ exportView: () => Promise.reject(new Error('disk full')) })} />,
    );
    await tick(80);
    view.stdin.write('e');
    await tick(80);

    expect(view.lastFrame()).toContain('Export failed: disk full');
    view.unmount();
  });

  it('reloads keeping the view, and keeps the old report when a reload fails', async () => {
    let calls = 0;
    const load = () => {
      calls += 1;
      return calls === 3 ? Promise.reject(new Error('gone')) : Promise.resolve(loaded());
    };
    const view = render(<App {...props({ load })} />);
    await tick(80);
    view.stdin.write('R');
    await tick(80);
    expect(view.lastFrame()).toContain('Reloaded');
    view.stdin.write('R');
    await tick(80);
    expect(view.lastFrame()).toContain('Reload failed: gone');
    view.unmount();
  });

  it('shows a load error and retries on R', async () => {
    let fail = true;
    const view = render(
      <App
        {...props({
          load: () => (fail ? Promise.reject(new Error('no sessions')) : Promise.resolve(loaded())),
        })}
      />,
    );
    await tick(80);
    expect(view.lastFrame()).toContain('no sessions');
    fail = false;
    view.stdin.write('R');
    await tick(80);
    expect(view.lastFrame()).toContain('Cost over time');
    view.unmount();
  });

  it('asks for a bigger terminal', () => {
    const view = render(<App {...props({ size: { width: 60, height: 20 } })} />);
    expect(view.lastFrame()).toContain('needs 80×24');
    view.unmount();
  });

  it('hands the view to keep to onQuit', async () => {
    const onQuit = vi.fn();
    const view = render(<App {...props({ onQuit })} />);
    await tick(80);
    view.stdin.write('2');
    await tick();
    view.stdin.write('q');
    await tick();

    expect(onQuit).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'breakdown', hideNames: false }),
    );
  });
});

describe('mountTui and runTui', () => {
  it('draws on the given terminal and quits on q', async () => {
    const terminal = createTerminal();
    const instance = mountTui({
      load: () => new Promise(() => undefined),
      exportView: () => Promise.resolve(''),
      diagnostics: new DiagnosticsStore(),
      streams: terminal.streams,
    });

    // Ink only settles a waitUntilExit() asked for before it exits.
    const exited = instance.waitUntilExit();
    await tick(120);
    await terminal.press('q');
    await exited;
    expect(terminal.output()).toContain('llm-usage');
  });

  it('resolves with the view to keep once the user quits', async () => {
    const terminal = createTerminal();
    const done = runTui({
      load: () => Promise.resolve(loaded()),
      exportView: () => Promise.resolve(''),
      diagnostics: new DiagnosticsStore(),
      colorLevel: 0,
      size: { width: 120, height: 40 },
      streams: terminal.streams,
    });

    await tick(120);
    await terminal.press('5');
    await terminal.press('q');

    expect(await done).toMatchObject({ tab: 'projects', hideNames: false });
  });
});

describe('captureStderr', () => {
  it('collects stderr and logger output while the TUI owns the screen, then replays warnings', () => {
    const store = new DiagnosticsStore();
    const restore = captureStderr(store);

    process.stderr.write('raw line\n');
    process.stderr.write(Buffer.from('bytes'));
    logger.warn('a warning');
    logger.info('scanned');
    restore();

    expect(store.list().map((message) => message.text)).toEqual([
      'raw line',
      'bytes',
      'a warning',
      'scanned',
    ]);
    const written: string[] = [];
    replayWarnings(store, (text) => written.push(text));
    expect(written).toEqual(['⚠ raw line\n', '⚠ bytes\n', '⚠ a warning\n']);
  });
});
