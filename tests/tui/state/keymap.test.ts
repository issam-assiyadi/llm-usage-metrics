import { describe, expect, it } from 'vitest';

import { KEY_HELP, mapKey } from '../../../src/tui/state/keymap.js';

describe('mapKey', () => {
  it('maps the screen keys to actions and effects', () => {
    expect(mapKey('c', { ctrl: true }, null)).toEqual({ effect: 'quit' });
    expect(mapKey('q', {}, null)).toEqual({ effect: 'quit' });
    expect(mapKey('R', {}, null)).toEqual({ effect: 'reload' });
    expect(mapKey('e', {}, null)).toEqual({ effect: 'export' });
    expect(mapKey('', { leftArrow: true }, null)).toEqual({
      action: { type: 'move', dx: -1, dy: 0 },
    });
    expect(mapKey('', { rightArrow: true }, null)).toEqual({
      action: { type: 'move', dx: 1, dy: 0 },
    });
    expect(mapKey('', { upArrow: true }, null)).toEqual({
      action: { type: 'move', dx: 0, dy: -1 },
    });
    expect(mapKey('', { downArrow: true }, null)).toEqual({
      action: { type: 'move', dx: 0, dy: 1 },
    });
    expect(mapKey('', { tab: true }, null)).toEqual({ action: { type: 'pane', delta: 1 } });
    expect(mapKey('', { tab: true, shift: true }, null)).toEqual({
      action: { type: 'pane', delta: -1 },
    });
    expect(mapKey('', { pageDown: true }, null)).toEqual({ action: { type: 'page', delta: 1 } });
    expect(mapKey('', { pageUp: true }, null)).toEqual({ action: { type: 'page', delta: -1 } });
    expect(mapKey('', { return: true }, null)).toEqual({ action: { type: 'enter' } });
    expect(mapKey('', { escape: true }, null)).toEqual({ action: { type: 'back' } });
    expect(mapKey('3', {}, null)).toEqual({ action: { type: 'tab', tab: 'rates' } });
    expect(mapKey('O', {}, null)).toEqual({ action: { type: 'sort', reverse: true } });
    expect(mapKey('z', {}, null)).toBeUndefined();
  });

  it('sends keys to an open dialog', () => {
    const filters = { kind: 'filters', group: 0, row: 0, query: '', searching: false } as const;

    expect(mapKey('', { escape: true }, filters)).toEqual({ action: { type: 'back' } });
    expect(mapKey('', { downArrow: true }, filters)).toEqual({
      action: { type: 'modalMove', dx: 0, dy: 1 },
    });
    expect(mapKey('', { return: true }, filters)).toEqual({ action: { type: 'modalSubmit' } });
    expect(mapKey('', { backspace: true }, filters)).toEqual({
      action: { type: 'modalBackspace' },
    });
    expect(mapKey(' ', {}, filters)).toEqual({ action: { type: 'modalToggle' } });
    expect(mapKey('a', {}, filters)).toEqual({ action: { type: 'modalAll' } });
    expect(mapKey('/', {}, filters)).toEqual({ action: { type: 'modalSearch' } });
    expect(mapKey('q', {}, filters)).toEqual({ action: { type: 'back' } });
    expect(mapKey('z', {}, filters)).toBeUndefined();
    expect(mapKey('a', {}, { ...filters, searching: true })).toEqual({
      action: { type: 'modalChar', char: 'a' },
    });

    const editing = {
      kind: 'period',
      row: 4,
      editing: { from: '', to: '', field: 'from' },
    } as const;
    expect(mapKey('', { tab: true }, editing)).toEqual({ action: { type: 'modalField' } });
    expect(mapKey('2', {}, editing)).toEqual({ action: { type: 'modalChar', char: '2' } });
    expect(mapKey('', { pageDown: true }, { kind: 'diagnostics', scroll: 0 })).toEqual({
      action: { type: 'modalMove', dx: 0, dy: 10 },
    });
  });

  it('describes every key it handles, with short footer labels', () => {
    expect(KEY_HELP.filter((entry) => entry.footer !== undefined).length).toBeGreaterThan(5);
    expect(KEY_HELP.every((entry) => entry.footer === undefined || entry.footer.length <= 16)).toBe(
      true,
    );
  });
});
