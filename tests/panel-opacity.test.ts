/**
 * The transparency setting, mirroring the visibility tests.
 *
 * The interesting properties are the clamp and the fallback: a corrupt value
 * must resolve to a readable panel, never to an invisible one, and one tab's
 * change must reach the other documents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPACITY,
  PANEL_OPACITY_KEY,
  onPanelOpacityChange,
  readPanelOpacity,
  writePanelOpacity,
} from '../src/lib/panel-opacity';

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

describe('panel opacity', () => {
  it('is fully opaque when nothing has been stored', async () => {
    await expect(readPanelOpacity()).resolves.toBe(1);
  });

  it('reads a stored value', async () => {
    store[PANEL_OPACITY_KEY] = 0.5;
    await expect(readPanelOpacity()).resolves.toBe(0.5);
  });

  it('falls back to opaque when the stored value is not a number', async () => {
    store[PANEL_OPACITY_KEY] = 'nope';
    await expect(readPanelOpacity()).resolves.toBe(DEFAULT_OPACITY);
  });

  it('clamps a stored value below the readable floor', async () => {
    store[PANEL_OPACITY_KEY] = 0;
    await expect(readPanelOpacity()).resolves.toBeGreaterThanOrEqual(0.2);
  });

  it('clamps a stored value above 1', async () => {
    store[PANEL_OPACITY_KEY] = 7;
    await expect(readPanelOpacity()).resolves.toBe(1);
  });

  it('clamps on write too', async () => {
    await writePanelOpacity(0);
    await expect(readPanelOpacity()).resolves.toBeGreaterThanOrEqual(0.2);
  });

  it('round-trips an in-range write', async () => {
    await writePanelOpacity(0.6);
    await expect(readPanelOpacity()).resolves.toBe(0.6);
  });

  it('notifies subscribers of a change', () => {
    const seen: number[] = [];
    onPanelOpacityChange((opacity) => seen.push(opacity));

    emit({ [PANEL_OPACITY_KEY]: { newValue: 0.4 } }, 'local');

    expect(seen).toEqual([0.4]);
  });

  it('clamps the value it hands a subscriber', () => {
    const seen: number[] = [];
    onPanelOpacityChange((opacity) => seen.push(opacity));

    emit({ [PANEL_OPACITY_KEY]: { newValue: 0 } }, 'local');

    expect(seen[0]).toBeGreaterThanOrEqual(0.2);
  });

  it('ignores another storage area and another key', () => {
    const seen: number[] = [];
    onPanelOpacityChange((opacity) => seen.push(opacity));

    emit({ [PANEL_OPACITY_KEY]: { newValue: 0.4 } }, 'sync');
    emit({ somethingElse: { newValue: 0.4 } }, 'local');

    expect(seen).toEqual([]);
  });

  it('treats a change to a non-number as the default', () => {
    const seen: number[] = [];
    onPanelOpacityChange((opacity) => seen.push(opacity));

    emit({ [PANEL_OPACITY_KEY]: { newValue: null } }, 'local');

    expect(seen).toEqual([DEFAULT_OPACITY]);
  });

  it('stops notifying once unsubscribed', () => {
    const seen: number[] = [];
    const unsubscribe = onPanelOpacityChange((opacity) => seen.push(opacity));

    unsubscribe();
    emit({ [PANEL_OPACITY_KEY]: { newValue: 0.4 } }, 'local');

    expect(seen).toEqual([]);
  });
});
