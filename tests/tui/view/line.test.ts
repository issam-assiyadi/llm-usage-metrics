import { describe, expect, it } from 'vitest';

import {
  badge,
  besides,
  cell,
  cutLine,
  fitLine,
  frame,
  keyCap,
  lineText,
  lineWidth,
  linesText,
  pill,
  plain,
  seg,
  seriesTone,
  shorten,
  wrapWords,
} from '../../../src/tui/view/line.js';

describe('lines', () => {
  it('pads, cuts and measures by display width', () => {
    expect(lineText(fitLine(plain('ab'), 4))).toBe('ab  ');
    expect(lineText(fitLine([seg('abc'), seg('def')], 4))).toBe('abcd');
    expect(fitLine(plain('ab'), 2)).toEqual(plain('ab'));
    expect(lineText(cutLine([seg('漢字'), seg('x')], 3))).toBe('漢 ');
    expect(lineWidth([seg('漢字')])).toBe(4);
  });

  it('shortens in the middle and aligns cells', () => {
    expect(shorten('abcdefghij', 5)).toBe('ab…ij');
    expect(cell('abc', 5)).toBe('abc  ');
    expect(cell('abc', 5, 'right')).toBe('  abc');
    expect(cell('abcdefgh', 4)).toBe('ab…h');
  });

  it('puts blocks side by side, padding the shorter one', () => {
    const lines = besides([
      { lines: [plain('a'), plain('b')], width: 2 },
      { lines: [plain('c')], width: 1 },
    ]);

    expect(linesText(lines)).toBe('a  c\nb   ');
  });

  it('frames a body with the title and aside in the border', () => {
    const lines = frame([plain('hi')], 20, { title: 'Title', aside: plain('x'), rounded: true });

    expect(linesText(lines)).toBe(
      ['╭─ Title ────── x ─╮', '│ hi               │', '╰──────────────────╯'].join('\n'),
    );
    expect(lines.every((line) => lineWidth(line) === 20)).toBe(true);
    expect(lines[0][0].style).toEqual({ fg: 'rule' });
    expect(frame([], 20, { active: true })[0][0].style).toEqual({ fg: 'accent' });
  });

  it('draws pills, badges and key caps', () => {
    expect(lineText(pill('ok'))).toBe('▐ok▌');
    expect(pill('ok', 'accent', true)[1].style).toEqual({
      fg: 'accent',
      inverse: true,
      bold: true,
    });
    expect(badge('x').text).toBe(' x ');
    expect(lineText(keyCap('f', 'filter'))).toBe('▐f▌ filter');
  });

  it('wraps words and names series tones', () => {
    expect(wrapWords('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapWords('abcdefghij', 5)).toEqual(['ab…ij']);
    expect(seriesTone(9, false)).toBe('series-1');
    expect(seriesTone(0, true)).toBe('series-other');
  });
});
