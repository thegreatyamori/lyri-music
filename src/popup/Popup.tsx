import { For, Show, createSignal, onMount } from 'solid-js';
import type { SourceId } from '../lib/domain/types';
import { readPanelVisible, writePanelVisible } from '../lib/panel-visibility';
import { readPanelOpacity, writePanelOpacity } from '../lib/panel-opacity';
import { PROVIDERS, defaultProviders } from '../lib/providers';

/**
 * The toolbar popup is the settings surface.
 *
 * The lyrics themselves belong in the panel, where they can follow the track;
 * a popup closes the moment you click away and would be the wrong home for
 * something you read while listening. What the popup is good for is the one
 * decision that is genuinely the user's: which services this extension is
 * allowed to talk to.
 */
export function Popup() {
  const [enabled, setEnabled] = createSignal<readonly SourceId[]>(
    defaultProviders().map((provider) => provider.id),
  );
  const [loaded, setLoaded] = createSignal(false);
  const [panelVisible, setPanelVisible] = createSignal(true);
  const [opacity, setOpacity] = createSignal(1);

  onMount(() => {
    void readPanelVisible().then(setPanelVisible);
    void readPanelOpacity().then(setOpacity);

    void chrome.runtime
      .sendMessage({ type: 'settings/get' })
      .then((response: unknown) => {
        const ids = readEnabled(response);
        if (ids !== null) setEnabled(ids);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  });

  async function togglePanel(): Promise<void> {
    const next = !panelVisible();
    setPanelVisible(next);
    await writePanelVisible(next);
  }

  // Live: every tick of the slider writes, so the panel follows the thumb.
  // Storage is local and synchronous enough that a dropped write would show as
  // one wrong frame, not as a setting that did not stick.
  async function changeOpacity(next: number): Promise<void> {
    setOpacity(next);
    await writePanelOpacity(next);
  }

  async function toggle(id: SourceId): Promise<void> {
    const next = enabled().includes(id)
      ? enabled().filter((value) => value !== id)
      : [...enabled(), id];
    setEnabled(next);
    await chrome.runtime.sendMessage({ type: 'settings/set', enabled: next }).catch(() => undefined);
  }

  return (
    <main class="popup">
      <h1 class="popup__title">LyriMusic</h1>

      <label class="popup__panel-toggle">
        <input type="checkbox" checked={panelVisible()} onChange={() => void togglePanel()} />
        <span>
          Show the lyrics panel
          <span class="popup__panel-hint">
            It lives inside the YouTube Music tab, bottom-right. Reload that tab after changing
            this.
          </span>
        </span>
      </label>

      <label class="popup__opacity">
        <span class="popup__opacity-head">
          Panel transparency
          <span class="popup__opacity-value">{Math.round(opacity() * 100)}%</span>
        </span>
        <input
          type="range"
          min="20"
          max="100"
          step="5"
          value={String(Math.round(opacity() * 100))}
          onInput={(event) => void changeOpacity(Number(event.currentTarget.value) / 100)}
        />
        <span class="popup__panel-hint">
          How much of the page shows through the panel. Applied live, no reload needed.
        </span>
      </label>

      <p class="popup__lead">Sources this extension may ask for lyrics.</p>

      <ul class="popup__sources">
        <For each={PROVIDERS}>
          {(provider) => (
            <li class="popup__source">
              <label class="popup__label">
                <input
                  type="checkbox"
                  checked={enabled().includes(provider.id)}
                  disabled={!loaded()}
                  onChange={() => void toggle(provider.id)}
                />
                <span class="popup__text">
                  <span class="popup__name">
                    {provider.label}
                    <Show when={provider.kind === 'plain'}>
                      <span class="popup__tag">text only</span>
                    </Show>
                  </span>
                  <span class="popup__detail">{provider.detail}</span>
                </span>
              </label>
            </li>
          )}
        </For>
      </ul>

      <p class="popup__note">
        Nothing is sent anywhere except these services, and only for the track you are playing.
        If the panel is missing, reload the YouTube Music tab and check its console for{' '}
        <code>[LyriMusic] panel mounted</code>.
      </p>
    </main>
  );
}

function readEnabled(response: unknown): readonly SourceId[] | null {
  if (typeof response !== 'object' || response === null) return null;
  const candidate = response as { type?: unknown; enabled?: unknown };
  if (candidate.type !== 'settings/answer') return null;
  if (!Array.isArray(candidate.enabled)) return null;
  return candidate.enabled.filter((value): value is SourceId => typeof value === 'string');
}
