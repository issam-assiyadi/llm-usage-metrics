// Imports the built TUI bundle (dist/tui.js, which `llm-usage tui` loads lazily) under the runtime running
// this script, renders its first frame to an in-memory terminal, and unmounts. Run it with
// `node` and with `bun`: Ink and React must load and draw on both.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

const tuiPath = path.resolve('dist/tui.js');

if (!existsSync(tuiPath)) {
  throw new Error('dist/tui.js is missing; run `pnpm run build` first');
}

const runtime =
  process.versions.bun === undefined ? `node ${process.version}` : `bun ${process.versions.bun}`;
const { mountTui } = await import(pathToFileURL(tuiPath).href);

const stdout = new PassThrough();
Object.assign(stdout, { columns: 100, rows: 30, isTTY: true });
const stdin = new PassThrough();
Object.assign(stdin, {
  isTTY: true,
  setRawMode: () => stdin,
  ref: () => stdin,
  unref: () => stdin,
});

let output = '';
stdout.on('data', (chunk) => {
  output += chunk.toString('utf8');
});

// A load that never settles: the smoke check is about drawing, not reading sessions.
const diagnostics = { subscribe: () => () => undefined, list: () => [] };
const instance = mountTui({
  load: () => new Promise(() => {}),
  exportView: () => Promise.resolve(''),
  diagnostics,
  colorLevel: 1,
  streams: { stdout, stdin },
});
await new Promise((resolve) => setTimeout(resolve, 200));
instance.unmount();

if (!output.includes('llm-usage')) {
  throw new Error(`${runtime}: the TUI drew no frame; got ${JSON.stringify(output.slice(0, 200))}`);
}

console.log(`${runtime}: dist/tui.js rendered a frame`);
