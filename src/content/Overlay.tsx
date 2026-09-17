import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { Lyrics, TrackMetadata } from '../lib/domain/types';
import { createLyricClock, type LyricClock } from '../lib/lyric-clock';
import type { SourceId } from '../lib/domain/types';
import { createNowPlaying } from './now-playing';
import tokensCss from '../styles/tokens.css?inline';
import panelCss from '../styles/panel.css?inline';

/**
 * What the panel is showing. The difference between `idle` and `empty` matters
 * to the user: one means nothing is playing, the other means the track is
 * playing and nobody has the words.
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly lyrics: Lyrics }
  | { readonly kind: 'empty' };

/** How much one press of the offset control moves the lyrics. */
const OFFSET_STEP_MS = 250;

export function Overlay() {
  const [track, setTrack] = createSignal<TrackMetadata | null>(null);
  const [state, setState] = createSignal<PanelState>({ kind: 'idle' });
  const [index, setIndex] = createSignal(-1);
  const [fraction, setFraction] = createSignal(0);
  const [offsetMs, setOffsetMs] = createSignal(0);
  const [hidden, setHidden] = createSignal(false);
  const [pipOpen, setPipOpen] = createSignal(false);

  const nowPlaying = createNowPlaying();

  /**
   * Rebuilt when the lines or the offset change. Re-sorting on a recreated
   * clock is a few microseconds for a lyric's worth of lines, and it buys a
   * clock with no mutable state — cheaper to reason about than to optimise.
   */
  const clock = createMemo<LyricClock | null>(() => {
    const current = state();
    if (current.kind !== 'ready') return null;
    return createLyricClock(current.lyrics.lines, offsetMs());
  });

  const sourceId = createMemo<SourceId | null>(() => {
    const current = state();
    return current.kind === 'ready' ? current.lyrics.sourceId : null;
  });

  /** Guards against a slow answer for the previous track overwriting this one. */
  let requestToken = 0;

  async function requestLyrics(next: TrackMetadata): Promise<void> {
    const token = ++requestToken;
    setState({ kind: 'loading' });

    let response: unknown;
    try {
      response = await chrome.runtime.sendMessage({ type: 'lyrics/for-track', track: next });
    } catch {
      // The background module can be starting up, or the extension reloaded.
      if (token === requestToken) setState({ kind: 'empty' });
      return;
    }

    if (token !== requestToken) return;

    const lyrics = readAnswer(response);
    setState(lyrics === null ? { kind: 'empty' } : { kind: 'ready', lyrics });
  }

  onMount(() => {
    const unsubscribe = nowPlaying.watch((next) => {
      setTrack(next);
      if (next === null) {
        requestToken += 1;
        setState({ kind: 'idle' });
        return;
      }
      void requestLyrics(next);
    });
    onCleanup(unsubscribe);
  });

  // The clock is driven from the animation frame rather than from the player's
  // events: YouTube Music does not emit one per frame, and the panel needs to
  // move between the events it does emit.
  onMount(() => {
    let frame = requestAnimationFrame(function tick() {
      const active = clock();
      const positionMs = nowPlaying.positionMs();
      if (active !== null && positionMs !== null) {
        setIndex(active.indexAt(positionMs));
        setFraction(active.fractionAt(positionMs));
      }
      frame = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  async function openPip(): Promise<void> {
    const api = window.documentPictureInPicture;
    if (api === undefined || pipOpen()) return;

    const pip = await api.requestWindow({ width: 360, height: 520 });

    const style = pip.document.createElement('style');
    style.textContent = `${tokensCss}\n${panelCss}`;
    pip.document.head.append(style);
    pip.document.body.classList.add('lyrimusic-pip');

    const mount = pip.document.createElement('div');
    pip.document.body.append(mount);

    setPipOpen(true);

    // The same component, a second time, against the same signals: the two
    // presentations cannot drift because there is only one source of truth.
    const dispose = render(
      () => (
        <LyricsList state={state} index={index} fraction={fraction} clampHeight={false} />
      ),
      mount,
    );

    pip.addEventListener('pagehide', () => {
      dispose();
      setPipOpen(false);
    });
  }

  return (
    <Show when={!hidden()}>
      <section class="lyrimusic" aria-label="Lyrics">
        <header class="lyrimusic__header">
          <div class="lyrimusic__heading">
            <p class="lyrimusic__title">{track()?.title ?? 'LyriMusic'}</p>
            <p class="lyrimusic__artist">{track()?.artist ?? 'Nothing playing'}</p>
          </div>

          <Show when={sourceId()}>
            {(id) => <span class="lyrimusic__badge">{id()}</span>}
          </Show>

          <button
            class="lyrimusic__icon-button"
            type="button"
            title="Pop out"
            onClick={() => void openPip()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8" />
              <rect x="12" y="11" width="8" height="6" rx="1.6" fill="currentColor" />
            </svg>
          </button>

          <button
            class="lyrimusic__icon-button"
            type="button"
            title="Hide"
            onClick={() => setHidden(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <Show when={!pipOpen()}>
          <LyricsList state={state} index={index} fraction={fraction} clampHeight />
        </Show>

        <footer class="lyrimusic__footer">
          <span>Lyrics {offsetMs() === 0 ? 'in sync' : `${offsetMs() > 0 ? '+' : ''}${offsetMs()} ms`}</span>
          <span class="lyrimusic__offset">
            <button type="button" title="Lyrics 250 ms earlier" onClick={() => setOffsetMs((v) => v - OFFSET_STEP_MS)}>
              −
            </button>
            <button type="button" title="Lyrics 250 ms later" onClick={() => setOffsetMs((v) => v + OFFSET_STEP_MS)}>
              +
            </button>
          </span>
        </footer>
      </section>
    </Show>
  );
}

interface LyricsListProps {
  readonly state: () => PanelState;
  readonly index: () => number;
  readonly fraction: () => number;
  readonly clampHeight: boolean;
}

function LyricsList(props: LyricsListProps) {
  let list: HTMLDivElement | undefined;

  createEffect(() => {
    const active = props.index();
    if (active < 0 || list === undefined) return;
    const line = list.querySelector<HTMLElement>(`[data-line="${active}"]`);
    line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  return (
    <Show
      when={props.state().kind === 'ready'}
      fallback={<p class="lyrimusic__state">{stateMessage(props.state())}</p>}
    >
      <div
        class="lyrimusic__lyrics"
        ref={list}
        style={props.clampHeight ? undefined : { 'max-height': 'none' }}
      >
        <For each={readyLines(props.state())}>
          {(line, i) => (
            <p
              class="lyrimusic__line"
              data-line={i()}
              classList={{
                'is-current': i() === props.index(),
                'is-plain': !hasTiming(props.state()),
              }}
              style={i() === props.index() ? { '--lyri-progress': String(props.fraction()) } : undefined}
            >
              {line.text}
            </p>
          )}
        </For>
      </div>
    </Show>
  );
}

function readyLines(state: PanelState): Lyrics['lines'] {
  return state.kind === 'ready' ? state.lyrics.lines : [];
}

function hasTiming(state: PanelState): boolean {
  return state.kind === 'ready' && state.lyrics.kind === 'synced';
}

function stateMessage(state: PanelState): string {
  switch (state.kind) {
    case 'idle':
      return 'Play something on YouTube Music';
    case 'loading':
      return 'Looking for lyrics…';
    case 'empty':
      return 'No lyrics found';
    default:
      return '';
  }
}

/**
 * The background always answers, but a malformed or unexpected reply must not
 * reach the panel as a crash. Anything unrecognised is treated as a miss.
 */
function readAnswer(response: unknown): Lyrics | null {
  if (typeof response !== 'object' || response === null) return null;
  const candidate = response as { type?: unknown; lyrics?: unknown };
  if (candidate.type !== 'lyrics/answer') return null;
  if (typeof candidate.lyrics !== 'object' || candidate.lyrics === null) return null;
  return candidate.lyrics as Lyrics;
}
