// The Ink app: reads the report, keeps the state, maps keys through the keymap and prints the
// lines `screen.ts` composes. Everything it draws is decided by the pure modules; this file
// only wires them to the terminal.

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { getDefaultViewState, type ShareReport } from '../share-report/client/core/index.js';
import { createMaskSource } from '../share-report/client/ui/state/context.js';
import { encodeViewState } from '../share-report/client/core/view-state.js';
import type { DiagnosticsStore } from './diagnostics.js';
import type { LoadedReport } from './load-report.js';
import {
  buildEnv,
  countDimensionTokens,
  createScreenModel,
  renderLoadError,
  renderLoading,
  renderScreen,
  renderTooSmall,
  MIN_HEIGHT,
  MIN_WIDTH,
} from './screen.js';
import type { SavedTuiView } from './session-files.js';
import { mapKey } from './state/keymap.js';
import { fromPortableView, toPortableView } from './state/portable-view.js';
import { createTuiState, reduceTui, type TuiAction, type TuiState } from './state/tui-state.js';
import { resolveTone, type ColorLevel } from './theme.js';
import type { Line } from './view/line.js';

export type AppProps = {
  load: () => Promise<LoadedReport>;
  /** The view the last run saved, restored once the report is read. */
  saved?: SavedTuiView;
  colorLevel: ColorLevel;
  diagnostics: DiagnosticsStore;
  /** Writes the view as an HTML report and opens it; returns the file's path. */
  exportView: (loaded: LoadedReport, viewHash: string) => Promise<string>;
  /** Called with the view to keep when the user quits. */
  onQuit: (saved: SavedTuiView | undefined) => void;
  /** The terminal size; read from stdout when absent. */
  size?: { width: number; height: number };
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; loaded: LoadedReport; state: TuiState };

function useTerminalSize(override: AppProps['size']): { width: number; height: number } {
  const { stdout } = useStdout();
  // One row short of the terminal: Ink clears the whole screen (and its scrollback) on every
  // frame as tall as the terminal, which flickers; one row less, it redraws in place.
  const read = useCallback(
    () =>
      override ?? {
        width: stdout.columns || MIN_WIDTH,
        height: Math.max(1, (stdout.rows || MIN_HEIGHT + 1) - 1),
      },
    [override, stdout],
  );
  const [size, setSize] = useState(read);

  useEffect(() => {
    const onResize = () => {
      setSize(read());
    };

    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [read, stdout]);

  return override ?? size;
}

function useSpinner(active: boolean): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => {
      setFrame((value) => value + 1);
    }, 80);
    return () => {
      clearInterval(timer);
    };
  }, [active]);

  return frame;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialState(report: ShareReport, saved: SavedTuiView | undefined): TuiState {
  const view = saved ? fromPortableView(saved.view, report) : getDefaultViewState(report);
  return createTuiState({ view, hideNames: saved?.hideNames ?? false, page: 0 }, saved?.tab);
}

export function Screen({ lines, colorLevel }: { lines: readonly Line[]; colorLevel: ColorLevel }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, row) => (
        <Text key={row} wrap="truncate">
          {line.map((segment, index) => (
            <Text
              key={index}
              color={resolveTone(segment.style?.fg, colorLevel)}
              backgroundColor={resolveTone(segment.style?.bg, colorLevel)}
              bold={segment.style?.bold}
              dimColor={segment.style?.dim}
              inverse={segment.style?.inverse}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const size = useTerminalSize(props.size);
  const mono = props.colorLevel === 0;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [reloading, setReloading] = useState(false);
  const spinner = useSpinner(phase.kind === 'loading' || reloading);
  const messages = useSyncExternalStore(
    useCallback(
      (listener: () => void) => props.diagnostics.subscribe(listener),
      [props.diagnostics],
    ),
    () => props.diagnostics.list().length,
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const runLoad = useCallback(
    async (previous: { loaded: LoadedReport; state: TuiState } | undefined) => {
      try {
        const loaded = await props.load();
        const state =
          previous === undefined
            ? initialState(loaded.report, props.saved)
            : {
                ...previous.state,
                ui: {
                  ...previous.state.ui,
                  view: fromPortableView(
                    toPortableView(previous.state.ui.view, previous.loaded.report),
                    loaded.report,
                  ),
                  page: 0,
                },
                status: 'Reloaded',
              };
        setPhase({ kind: 'ready', loaded, state });
      } catch (error) {
        if (previous === undefined) {
          setPhase({ kind: 'error', message: describeError(error) });
        } else {
          setPhase({
            kind: 'ready',
            ...previous,
            state: { ...previous.state, status: `Reload failed: ${describeError(error)}` },
          });
        }
      } finally {
        setReloading(false);
      }
    },
    [props],
  );

  useEffect(() => {
    void runLoad(undefined);
  }, [runLoad]);

  const ready = phase.kind === 'ready' ? phase : undefined;
  const report = ready?.loaded.report;
  const mask = useMemo(() => (report ? createMaskSource(report) : undefined), [report]);
  const tokens = useMemo(() => (report ? countDimensionTokens(report) : undefined), [report]);
  const model = useMemo(
    () =>
      ready && mask && tokens
        ? createScreenModel(
            ready.loaded.report,
            ready.state,
            mask,
            tokens,
            props.diagnostics.list(),
          )
        : undefined,
    // `messages` changes when a warning arrives, so the badge and drawer follow.
    [ready, mask, tokens, messages, props.diagnostics],
  );

  const quit = useCallback(() => {
    const current = phaseRef.current;
    props.onQuit(
      current.kind === 'ready'
        ? {
            view: toPortableView(current.state.ui.view, current.loaded.report),
            hideNames: current.state.ui.hideNames,
            tab: current.state.tab,
          }
        : undefined,
    );
    exit();
  }, [exit, props]);

  const dispatch = useCallback(
    (action: TuiAction) => {
      setPhase((current) => {
        if (current.kind !== 'ready' || !model) {
          return current;
        }

        const env = buildEnv(model, size, mono);
        const state = reduceTui(current.state, action, env);
        return state === current.state ? current : { ...current, state };
      });
    },
    [model, mono, size],
  );

  useInput((input, key) => {
    const current = phaseRef.current;
    const result = mapKey(input, key, current.kind === 'ready' ? current.state.modal : null);

    if (result === undefined) {
      return;
    }

    if ('effect' in result) {
      if (result.effect === 'quit') {
        quit();
        return;
      }

      if (result.effect === 'reload') {
        if (current.kind === 'ready' && !reloading) {
          setReloading(true);
          dispatch({ type: 'status', text: 'Reloading…' });
          void runLoad({ loaded: current.loaded, state: current.state });
        } else if (current.kind === 'error') {
          setPhase({ kind: 'loading' });
          void runLoad(undefined);
        }

        return;
      }

      if (current.kind === 'ready') {
        const { loaded, state } = current;
        dispatch({ type: 'status', text: 'Exporting…' });
        props
          .exportView(loaded, encodeViewState(state.ui.view, loaded.report))
          .then((filePath) => {
            dispatch({
              type: 'status',
              text: `Opened ${filePath}${state.ui.hideNames ? ' (names are in the file; use Hide names there)' : ''}`,
            });
          })
          .catch((error: unknown) => {
            dispatch({ type: 'status', text: `Export failed: ${describeError(error)}` });
          });
      }

      return;
    }

    if (current.kind === 'ready') {
      dispatch(result.action);
    }
  });

  let lines: Line[];

  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
    lines = renderTooSmall(size);
  } else if (phase.kind === 'loading') {
    lines = renderLoading(size, spinner, 'Reading your sessions and pricing them…');
  } else if (phase.kind === 'error') {
    lines = renderLoadError(size, phase.message);
  } else if (model) {
    lines = renderScreen(model, size, mono, props.colorLevel === 1);
  } else {
    lines = [];
  }

  return <Screen lines={lines} colorLevel={props.colorLevel} />;
}
