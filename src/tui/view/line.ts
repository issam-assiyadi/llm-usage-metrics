// The TUI draws every screen as lines of styled segments: plain data that tests read as text
// and the Ink layer prints. Colours are named tones that `../theme.ts` resolves for the
// terminal at hand, so nothing here knows about truecolor or NO_COLOR.

import { padEndVisible, truncateMiddle, visibleWidth } from '../../render/table-text-layout.js';

/** A named colour: interface roles, the chart series (0–7, then `other`) and heat levels. */
export type Tone =
  | 'accent'
  | 'muted'
  | 'ink'
  | 'rule'
  | 'notice'
  | 'series-0'
  | 'series-1'
  | 'series-2'
  | 'series-3'
  | 'series-4'
  | 'series-5'
  | 'series-6'
  | 'series-7'
  | 'series-other'
  | 'heat-0'
  | 'heat-1'
  | 'heat-2'
  | 'heat-3'
  | 'heat-4';

export type Style = {
  fg?: Tone;
  bg?: Tone;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
};

export type Segment = { text: string; style?: Style };

export type Line = Segment[];

export const SERIES_TONES = [
  'series-0',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
] as const satisfies readonly Tone[];

/** The tone of a stacked series: by slot, or the merged remainder. */
export function seriesTone(slot: number, other: boolean): Tone {
  return other ? 'series-other' : SERIES_TONES[slot % SERIES_TONES.length];
}

export function seg(text: string, style?: Style): Segment {
  return style === undefined ? { text } : { text, style };
}

export function plain(text: string): Line {
  return [seg(text)];
}

export function lineText(line: Line): string {
  return line.map((segment) => segment.text).join('');
}

export function lineWidth(line: Line): number {
  return visibleWidth(lineText(line));
}

/** The lines as plain text, one per row: what tests compare. */
export function linesText(lines: readonly Line[]): string {
  return lines.map(lineText).join('\n');
}

/** Pads with spaces, or cuts, to exactly `width` columns. */
export function fitLine(line: Line, width: number): Line {
  const current = lineWidth(line);

  if (current === width) {
    return line;
  }

  if (current < width) {
    return [...line, seg(' '.repeat(width - current))];
  }

  return cutLine(line, width);
}

/** The first `width` columns; a segment cut short ends with `…` when room allows. */
export function cutLine(line: Line, width: number): Line {
  const result: Line = [];
  let room = width;

  for (const segment of line) {
    if (room <= 0) {
      break;
    }

    const segmentWidth = visibleWidth(segment.text);

    if (segmentWidth <= room) {
      result.push(segment);
      room -= segmentWidth;
      continue;
    }

    const cut = takeColumns(segment.text, room);
    result.push(seg(cut, segment.style));
    room -= visibleWidth(cut);
    break;
  }

  if (room > 0) {
    result.push(seg(' '.repeat(room)));
  }

  return result;
}

/** The leading characters of `text` that fit in `width` columns. */
function takeColumns(text: string, width: number): string {
  let taken = '';

  for (const character of text) {
    if (visibleWidth(taken + character) > width) {
      break;
    }

    taken += character;
  }

  return taken;
}

/** Text cut to `width` with a middle ellipsis, so both ends of a long name stay readable. */
export function shorten(text: string, width: number): string {
  return truncateMiddle(text, Math.max(0, width));
}

/** Text padded or shortened to exactly `width` columns, aligned left or right. */
export function cell(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const short = shorten(text, width);
  const pad = ' '.repeat(Math.max(0, width - visibleWidth(short)));

  return align === 'left' ? padEndVisible(short, width) : pad + short;
}

/**
 * Blocks side by side, each padded to its own width, with `gap` spaces between; the shorter
 * blocks are padded with blank rows.
 */
export function besides(
  blocks: readonly { lines: readonly Line[]; width: number }[],
  gap = 1,
): Line[] {
  const height = Math.max(0, ...blocks.map((block) => block.lines.length));

  return Array.from({ length: height }, (_, row) =>
    blocks.flatMap((block, index) => [
      ...(index > 0 ? [seg(' '.repeat(gap))] : []),
      ...fitLine(block.lines[row] ?? [], block.width),
    ]),
  );
}

export type FrameOptions = {
  /** Text set into the top border, after the corner. */
  title?: string;
  /** Text set into the top border at the right. */
  aside?: Line;
  /** Text set into the bottom border. */
  footer?: Line;
  /** Draws the border in the accent tone (the pane with the keyboard). */
  active?: boolean;
  /** Rounded corners, as WebTUI's focused boxes. */
  rounded?: boolean;
};

/**
 * A box `width` columns wide around `body`, the title and aside set into the top border as in
 * WebTUI, and each body line padded to the inside width with one space of padding each side.
 */
export function frame(body: readonly Line[], width: number, options: FrameOptions = {}): Line[] {
  const border: Style = options.active ? { fg: 'accent' } : { fg: 'rule' };
  const corners = options.rounded ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘'];
  const inner = Math.max(0, width - 2);

  return [
    borderLine(corners[0], corners[1], inner, border, options.title, options.aside, options.active),
    ...body.map((line) => [
      seg('│', border),
      seg(' '),
      ...fitLine(line, Math.max(0, inner - 2)),
      seg(' '),
      seg('│', border),
    ]),
    borderLine(corners[2], corners[3], inner, border, undefined, options.footer, false),
  ];
}

function borderLine(
  left: string,
  right: string,
  inner: number,
  border: Style,
  title: string | undefined,
  aside: Line | undefined,
  active: boolean | undefined,
): Line {
  const titleText = title === undefined || inner < 6 ? '' : ` ${shorten(title, inner - 4)} `;
  const titleSegment = seg(titleText, { fg: active ? 'accent' : 'ink', bold: true });
  const room = inner - 1 - visibleWidth(titleText);
  const asideLine = aside !== undefined && room > lineWidth(aside) + 2 ? aside : [];
  const asideWidth = lineWidth(asideLine);
  const fill = Math.max(0, room - asideWidth - (asideWidth > 0 ? 3 : 0));

  return [
    seg(left + '─', border),
    ...(titleText === '' ? [] : [titleSegment]),
    seg('─'.repeat(fill), border),
    ...(asideWidth > 0 ? [seg(' '), ...asideLine, seg(' ─', border)] : []),
    seg(right, border),
  ];
}

/**
 * A WebTUI badge: the text on a filled pill whose ends are half blocks (▐ text ▌), so it
 * reads rounded without a patched font.
 */
export function pill(text: string, tone: Tone = 'muted', bold = false): Segment[] {
  return [
    seg('▐', { fg: tone }),
    seg(text, { fg: tone, inverse: true, bold }),
    seg('▌', { fg: tone }),
  ];
}

/** A single-segment badge, for places that take one segment. */
export function badge(text: string, tone: Tone = 'muted'): Segment {
  return seg(` ${text} `, { fg: tone, inverse: true });
}

/** A key as a WebTUI button cap, then what it does: `▐f▌ filter`. */
export function keyCap(key: string, label: string, tone: Tone = 'accent'): Segment[] {
  return [...pill(key, tone, true), seg(` ${label}`, { fg: 'muted' })];
}

/** Wraps prose to `width` columns at spaces; a word longer than a line is shortened. */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/u).filter((part) => part !== '')) {
    const candidate = current === '' ? word : `${current} ${word}`;

    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }

    if (current !== '') {
      lines.push(current);
    }

    current = visibleWidth(word) <= width ? word : shorten(word, width);
  }

  if (current !== '') {
    lines.push(current);
  }

  return lines;
}
