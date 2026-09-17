import { For, Show, createSignal, onMount } from 'solid-js';
import type { SourceId } from '../lib/domain/types';
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

  onMount(() => {
    void chrome.runtime
      .sendMessage({ type: 'settings/get' })
      .then((response: unknown) => {
        const ids = readEnabled(response);
        if (ids !== null) setEnabled(ids);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  });

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
