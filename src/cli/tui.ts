// The TUI bundle's entry (dist/tui.js), next to index.js: `run-tui-command.ts` imports it by a
// URL relative to itself, so it stays out of the CLI bundle and every other command's startup.
export { mountTui, runTui } from '../tui/run-tui.js';
export type { TuiDeps } from '../tui/run-tui.js';
