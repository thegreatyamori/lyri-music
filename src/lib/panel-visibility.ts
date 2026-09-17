/**
 * Whether the in-page panel is showing.
 *
 * This lives in storage rather than in the panel's own component state for one
 * reason: the panel has a hide button, and a hide with no way back is a trap.
 * The popup is where you get it back, the popup is a different document, and
 * the only thing two documents can share is a setting.
 *
 * Kept in one module so the key name exists once. The popup writes it, the
 * panel reads it and subscribes to it, and neither has to know the other did.
 */

import type { StorageChange } from './chrome-types';

export const PANEL_VISIBLE_KEY = 'settings.panelVisible';

const DEFAULT_VISIBLE = true;

export async function readPanelVisible(): Promise<boolean> {
  const bag = await chrome.storage.local.get(PANEL_VISIBLE_KEY);
  return asBoolean(bag[PANEL_VISIBLE_KEY]) ?? DEFAULT_VISIBLE;
}

export async function writePanelVisible(visible: boolean): Promise<void> {
  await chrome.storage.local.set({ [PANEL_VISIBLE_KEY]: visible });
}

/**
 * Calls back when the setting is changed by anyone — the popup, or another tab.
 * Returns an unsubscribe function.
 */
export function onPanelVisibleChange(onChange: (visible: boolean) => void): () => void {
  const listener = (
    changes: Record<string, StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[PANEL_VISIBLE_KEY];
    if (change === undefined) return;
    onChange(asBoolean(change.newValue) ?? DEFAULT_VISIBLE);
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
