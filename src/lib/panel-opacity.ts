/**
 * How transparent the in-page panel's background is, from 0 to 1.
 *
 * Stored rather than kept in component state for the same reason as visibility:
 * the control lives in the popup, the effect lives in the panel, and they are
 * two documents. A subscriber on each side keeps them in step without either
 * one importing the other.
 *
 * The value drives the background's alpha (`--lyri-panel-alpha`), not the
 * section's `opacity` — fading the section fades the lyrics too, and a control
 * for how much page shows through should not cost the words their contrast.
 *
 * Clamped on every read and every change. The clamp is not cosmetic — below
 * ~0.2 the panel stops being a panel and becomes a ghost of one, and a value
 * written by hand into storage should not be able to do that to the user.
 */

import type { StorageChange } from './chrome-types';

export const PANEL_OPACITY_KEY = 'settings.panelOpacity';

export const DEFAULT_OPACITY = 1;

/** Opaque enough that text stays readable; transparent enough to see through. */
const MIN_OPACITY = 0.2;

export async function readPanelOpacity(): Promise<number> {
  const bag = await chrome.storage.local.get(PANEL_OPACITY_KEY);
  return clamp(asNumber(bag[PANEL_OPACITY_KEY]) ?? DEFAULT_OPACITY);
}

export async function writePanelOpacity(opacity: number): Promise<void> {
  await chrome.storage.local.set({ [PANEL_OPACITY_KEY]: clamp(opacity) });
}

/**
 * Calls back when the setting is changed by anyone — the popup, or another tab.
 * Returns an unsubscribe function.
 */
export function onPanelOpacityChange(onChange: (opacity: number) => void): () => void {
  const listener = (
    changes: Record<string, StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[PANEL_OPACITY_KEY];
    if (change === undefined) return;
    onChange(clamp(asNumber(change.newValue) ?? DEFAULT_OPACITY));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OPACITY;
  return Math.min(1, Math.max(MIN_OPACITY, value));
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
