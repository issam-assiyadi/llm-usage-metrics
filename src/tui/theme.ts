// How the TUI's tones become colours on the terminal at hand. Truecolor terminals get the
// share report's dark palette (src/share-report/client/styles.css), others the 16 ANSI
// colours, and NO_COLOR gets none: the charts then tell series apart by glyph patterns.

import type { Tone } from './view/line.js';

/** 0: no colour; 1: the 16 ANSI colours; 3: 24-bit colour. */
export type ColorLevel = 0 | 1 | 3;

export function resolveColorLevel(env: NodeJS.ProcessEnv = process.env): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return 0;
  }

  if (env.FORCE_COLOR === '0') {
    return 0;
  }

  const colorTerm = env.COLORTERM?.toLowerCase();

  return colorTerm === 'truecolor' || colorTerm === '24bit' ? 3 : 1;
}

// The share report's dark-theme values, so the terminal and the browser draw the same series.
const TRUECOLOR: Record<Tone, string> = {
  accent: '#df7b52',
  muted: '#a1a49a',
  ink: '#f1f0e9',
  rule: '#5f655b',
  notice: '#d8ae66',
  'series-0': '#df7b52',
  'series-1': '#65aeb8',
  'series-2': '#d8ae66',
  'series-3': '#b58ccc',
  'series-4': '#9cbf6a',
  'series-5': '#8da3e6',
  'series-6': '#e07f98',
  'series-7': '#c4a07a',
  'series-other': '#74786d',
  'heat-0': '#2a2e26',
  'heat-1': '#4a2c20',
  'heat-2': '#7d4129',
  'heat-3': '#b75a37',
  'heat-4': '#f09a72',
};

// Yellow, green and red mean money and good or bad in the CLI's tables (ColorRoles), so the
// series keep to the other hues; the heat ramp uses the accent's red family on its own grid.
const ANSI16: Record<Tone, string> = {
  accent: 'redBright',
  muted: 'gray',
  ink: 'white',
  rule: 'gray',
  notice: 'yellow',
  'series-0': 'redBright',
  'series-1': 'cyan',
  'series-2': 'magenta',
  'series-3': 'blue',
  'series-4': 'cyanBright',
  'series-5': 'magentaBright',
  'series-6': 'blueBright',
  'series-7': 'white',
  'series-other': 'gray',
  'heat-0': 'gray',
  'heat-1': 'red',
  'heat-2': 'red',
  'heat-3': 'redBright',
  'heat-4': 'redBright',
};

/** The colour Ink should draw a tone in, or undefined to leave the terminal's own. */
export function resolveTone(tone: Tone | undefined, level: ColorLevel): string | undefined {
  if (tone === undefined || level === 0) {
    return undefined;
  }

  return level === 3 ? TRUECOLOR[tone] : ANSI16[tone];
}
