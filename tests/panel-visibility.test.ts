/**
 * The setting that the hide button writes and the popup restores.
 *
 * The bug this exists to prevent is a one-way door: the panel could be hidden
 * and nothing could bring it back. These tests pin the two halves of the fix —
 * that the default is visible, and that a change made in one document reaches
 * the other.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_VISIBLE_KEY,
  onPanelVisibleChange,
  readPanelVisible,
  writePanelVisible,
} from '../src/lib/panel-visibility';

type Listener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

let store: Record<string, unknown>;
let listeners: Listener[];

function emit(changes: Record<string, { newValue?: unknown }>, areaName: string): void {
  for (const listener of listeners) listener(changes, areaName);
}

beforeEach(() => {
  store = {};
  listeners = [];

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
        set: (bag: Record<string, unknown>) => {
          Object.assign(store, bag);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (listener: Listener) => {
          listeners.push(listener);
        },
        removeListener: (listener: Listener) => {
          listeners = listeners.filter((existing) => existing !== listener);
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('panel visibility', () => {
  it('is visible when nothing has been stored', async () => {
    await expect(readPanelVisible()).resolves.toBe(true);
  });

  it('reads a stored false', async () => {
    store[PANEL_VISIBLE_KEY] = false;
    await expect(readPanelVisible()).resolves.toBe(false);
  });

  it('falls back to visible when the stored value is not a boolean', async () => {
    // Defensive on purpose: a value written by an older version, or a JSON
    // round trip that turned it into a string, must not hide the panel forever.
    store[PANEL_VISIBLE_KEY] = 'nope';
    await expect(readPanelVisible()).resolves.toBe(true);
  });

  it('round-trips a write', async () => {
    await writePanelVisible(false);
    await expect(readPanelVisible()).resolves.toBe(false);
    await writePanelVisible(true);
    await expect(readPanelVisible()).resolves.toBe(true);
  });

  it('notifies subscribers of a change', () => {
    const seen: boolean[] = [];
    onPanelVisibleChange((visible) => seen.push(visible));

    emit({ [PANEL_VISIBLE_KEY]: { newValue: false } }, 'local');

    expect(seen).toEqual([false]);
  });

  it('ignores another storage area and another key', () => {
    const seen: boolean[] = [];
    onPanelVisibleChange((visible) => seen.push(visible));

    emit({ [PANEL_VISIBLE_KEY]: { newValue: false } }, 'sync');
    emit({ somethingElse: { newValue: false } }, 'local');

    expect(seen).toEqual([]);
  });

  it('treats a change to a non-boolean as visible rather than as hidden', () => {
    const seen: boolean[] = [];
    onPanelVisibleChange((visible) => seen.push(visible));

    emit({ [PANEL_VISIBLE_KEY]: { newValue: null } }, 'local');

    expect(seen).toEqual([true]);
  });

  it('stops notifying once unsubscribed', () => {
    const seen: boolean[] = [];
    const unsubscribe = onPanelVisibleChange((visible) => seen.push(visible));

    unsubscribe();
    emit({ [PANEL_VISIBLE_KEY]: { newValue: false } }, 'local');

    expect(seen).toEqual([]);
  });
});
