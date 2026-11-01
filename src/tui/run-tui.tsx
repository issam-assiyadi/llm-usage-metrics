// The TUI's entry: Ink and the screens, and nothing that reads usage. `llm-usage tui` (and a
// bare `llm-usage` in a terminal) loads it as its own bundle (dist/tui.js) and hands it the
// loader, the export and the saved view, so this bundle never carries the data pipeline.

import { render, type Instance } from 'ink';

import { App } from './app.js';
import type { DiagnosticsStore } from './diagnostics.js';
import type { LoadedReport } from './load-report.js';
import type { SavedTuiView } from './session-files.js';
import { resolveColorLevel, type ColorLevel } from './theme.js';

/** The streams Ink draws on and reads keys from; the process's own by default. */
export type TuiStreams = {
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
};

export type TuiDeps = {
  load: () => Promise<LoadedReport>;
  exportView: (loaded: LoadedReport, viewHash: string) => Promise<string>;
  diagnostics: DiagnosticsStore;
  /** The view the last run kept, restored once the report is read. */
  saved?: SavedTuiView;
  colorLevel?: ColorLevel;
  size?: { width: number; height: number };
  streams?: TuiStreams;
};

/** Mounts the TUI and returns the Ink instance (the smoke check renders one frame with it). */
export function mountTui(
  deps: TuiDeps,
  onQuit: (saved: SavedTuiView | undefined) => void = () => undefined,
): Instance {
  return render(
    <App
      load={deps.load}
      saved={deps.saved}
      colorLevel={deps.colorLevel ?? resolveColorLevel()}
      diagnostics={deps.diagnostics}
      exportView={deps.exportView}
      onQuit={onQuit}
      size={deps.size}
    />,
    { ...deps.streams, patchConsole: false, exitOnCtrlC: false },
  );
}

/** Runs the TUI until the user quits; resolves with the view to keep for the next run. */
export async function runTui(deps: TuiDeps): Promise<SavedTuiView | undefined> {
  let toSave: SavedTuiView | undefined;
  const instance = mountTui(deps, (view) => {
    toSave = view;
  });

  await instance.waitUntilExit();
  return toSave;
}
