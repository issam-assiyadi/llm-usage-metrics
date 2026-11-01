import { captureStderr, replayWarnings } from '../tui/capture-stderr.js';
import { DiagnosticsStore } from '../tui/diagnostics.js';
import { loadTuiReport, type LoadedReport } from '../tui/load-report.js';
import {
  exportView,
  getSavedViewPath,
  readSavedView,
  writeSavedView,
  type SavedTuiView,
} from '../tui/session-files.js';
import type { TuiDeps } from '../tui/run-tui.js';
import type { TuiCommandOptions } from './usage-data-contracts.js';

export const TUI_NEEDS_TERMINAL_MESSAGE =
  "tui needs an interactive terminal; use 'llm-usage summary' for text output";

type InteractiveStreams = {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
};

/** Whether both ends are a terminal the TUI can draw on and read keys from. */
export function isInteractiveTerminal(streams: InteractiveStreams = process): boolean {
  return streams.stdin.isTTY === true && streams.stdout.isTTY === true;
}

/**
 * A bare `llm-usage` in an interactive terminal opens the TUI; anywhere else (a pipe, CI, a
 * dumb terminal, `LLM_USAGE_NO_TUI` set) and with any argument it stays the summary, so
 * scripts that run `llm-usage` keep their text output. Returns the argv commander parses.
 */
export function routeBareRunToTui(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  streams: InteractiveStreams = process,
): string[] {
  const optedOut = (value: string | undefined) =>
    value !== undefined && value !== '' && value !== '0';
  const bare = argv.length === 2;

  if (
    !bare ||
    !isInteractiveTerminal(streams) ||
    optedOut(env.CI) ||
    optedOut(env.LLM_USAGE_NO_TUI) ||
    env.TERM === 'dumb'
  ) {
    return [...argv];
  }

  return [...argv, 'tui'];
}

export type TuiModule = {
  runTui: (deps: TuiDeps) => Promise<SavedTuiView | undefined>;
};

/**
 * Ink and React load only here, so no other command (statusline ticks above all) pays for
 * them. The TUI is its own bundle next to this one (dist/tui.js; src/cli/tui.ts from source),
 * imported by a computed URL so the bundler leaves it out of the CLI bundle.
 */
export async function loadTuiModule(): Promise<TuiModule> {
  // eslint-disable-next-line no-restricted-syntax -- keeps Ink and React out of every other command's startup
  const module: unknown = await import(new URL('./tui.js', import.meta.url).href);

  if (!isTuiModule(module)) {
    throw new Error('The TUI bundle (tui.js) could not be loaded; reinstall llm-usage-metrics');
  }

  return module;
}

function isTuiModule(value: unknown): value is TuiModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runTui' in value &&
    typeof value.runTui === 'function'
  );
}

export type RunTuiCommandDeps = {
  streams?: InteractiveStreams;
  loadModule?: () => Promise<TuiModule>;
  load?: () => Promise<LoadedReport>;
  exportView?: TuiDeps['exportView'];
  /** Where the last view is kept; the user cache by default. */
  savedViewPath?: string;
  writeStderr?: (text: string) => void;
};

export async function runTuiCommand(
  options: TuiCommandOptions,
  deps: RunTuiCommandDeps = {},
): Promise<void> {
  if (!isInteractiveTerminal(deps.streams)) {
    throw new Error(TUI_NEEDS_TERMINAL_MESSAGE);
  }

  const { runTui } = await (deps.loadModule ?? loadTuiModule)();
  const diagnostics = new DiagnosticsStore();
  const savedViewPath = deps.savedViewPath ?? getSavedViewPath();
  const saved = await readSavedView(savedViewPath);
  const restore = captureStderr(diagnostics);
  let toSave: SavedTuiView | undefined;

  try {
    toSave = await runTui({
      load: deps.load ?? (() => loadTuiReport(options)),
      exportView: deps.exportView ?? ((loaded, viewHash) => exportView(loaded.data, viewHash)),
      diagnostics,
      saved,
    });
  } finally {
    restore();
  }

  if (toSave !== undefined) {
    try {
      await writeSavedView(savedViewPath, toSave);
    } catch {
      // A view that cannot be kept only means the next run opens on the default one.
    }
  }

  replayWarnings(diagnostics, deps.writeStderr ?? ((text) => process.stderr.write(text)));
}
