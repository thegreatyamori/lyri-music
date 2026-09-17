import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { Lyrics, TrackMetadata } from '../lib/domain/types';
import { hasTiming } from '../lib/domain/lyrics';
import { createLyricClock, type LyricClock } from '../lib/lyric-clock';
import type { SourceId } from '../lib/domain/types';
import { createNowPlaying } from './now-playing';
import { openPipShell } from './pip-window';
import {
  onPanelVisibleChange,
  readPanelVisible,
  writePanelVisible,
} from '../lib/panel-visibility';
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
  | { readonly kind: 'empty' }
  /**
   * The background module could not be reached at all. Kept separate from
   * `empty` because they call for opposite reactions: `empty` means the sources
   * were asked and nobody had the words, this one means nobody was asked.
   */
  | { readonly kind: 'unavailable' };

/** How much one press of the offset control moves the lyrics. */
const OFFSET_STEP_MS = 250;

/**
 * How long to let the page settle before asking about a track.
 *
 * Long enough for the title and artist to catch up with the url after a song
 * change, short enough that nobody notices the wait. The alternative was asking
 * immediately and asking about the wrong song, which is what the panel used to
 * do.
 */
const METADATA_SETTLE_MS = 350;

export function Overlay() {
  const [track, setTrack] = createSignal<TrackMetadata | null>(null);
  const [state, setState] = createSignal<PanelState>({ kind: 'idle' });
  const [index, setIndex] = createSignal(-1);
  const [fraction, setFraction] = createSignal(0);
  const [offsetMs, setOffsetMs] = createSignal(0);
  // The popup owns this setting, so hiding from here and showing from there are
  // the same state, and neither can leave the other stranded.
  const [panelVisible, setPanelVisible] = createSignal(true);
  const [pipOpen, setPipOpen] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);

  const nowPlaying = createNowPlaying();

  /**
   * Rebuilt when the lines or the offset change. Re-sorting on a recreated
   * clock is a few microseconds for a lyric's worth of lines, and it buys a
   * clock with no mutable state — cheaper to reason about than to optimise.
   *
   * Null for lyrics that cannot be followed, which is the point: handing a clock
   * untimed lines does not leave the panel merely unhighlighted, it pins the
   * view to the last line of the song. See `hasTiming`.
   */
  const clock = createMemo<LyricClock | null>(() => {
    const current = state();
    if (current.kind !== 'ready' || !hasTiming(current.lyrics)) return null;
    return createLyricClock(current.lyrics.lines, offsetMs());
  });

  /** Whether the offset control means anything for what is on screen. */
  const timed = createMemo(() => {
    const current = state();
    return current.kind === 'ready' && hasTiming(current.lyrics);
  });

  const sourceId = createMemo<SourceId | null>(() => {
    const current = state();
    return current.kind === 'ready' ? current.lyrics.sourceId : null;
  });

  /** Guards against a slow answer for the previous track overwriting this one. */
  let requestToken = 0;

  async function requestLyrics(next: TrackMetadata, force: boolean): Promise<void> {
    const token = ++requestToken;
    setState({ kind: 'loading' });

    let response: unknown;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'lyrics/for-track',
        track: next,
        force,
      });
    } catch (error) {
      // The background module can be starting up, or the extension may have been
      // reloaded under this tab. Neither is "no lyrics exist", and saying so
      // would send the user looking in the wrong place.
      console.warn('[LyriMusic] background unreachable', error);
      if (token === requestToken) setState({ kind: 'unavailable' });
      return;
    }

    if (token !== requestToken) return;

    const answer = readAnswer(response, next.videoId);
    console.info('[LyriMusic] answer', {
      videoId: next.videoId,
      force,
      outcome: answer.kind,
      source: answer.kind === 'lyrics' ? answer.lyrics.sourceId : null,
    });

    switch (answer.kind) {
      case 'lyrics':
        setState({ kind: 'ready', lyrics: answer.lyrics });
        return;
      case 'none':
        setState({ kind: 'empty' });
        return;
      case 'stale':
        // An answer for a track this panel is no longer showing. Ignoring it
        // leaves the state alone; whatever is current will report for itself.
        return;
    }
  }

  /**
   * Ask again, ignoring what the cache remembers.
   *
   * A remembered miss is indistinguishable, in the panel, from a lookup that
   * failed — so this is the affordance that makes the difference recoverable
   * without reloading the page or clearing extension storage by hand.
   */
  async function refresh(): Promise<void> {
    const current = track();
    if (current === null || refreshing()) return;

    setRefreshing(true);
    try {
      await requestLyrics(current, true);
    } finally {
      setRefreshing(false);
    }
  }

  onMount(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = nowPlaying.watch((next) => {
      setTrack(next);
      if (pending !== undefined) clearTimeout(pending);

      // Wait for the metadata to settle before acting on it, whichever way it
      // moved.
      //
      // The pieces do not arrive together and they do not arrive in order: the
      // url knows the new track before the page knows its name, and navigating —
      // collapsing the player, opening the library — can blank the metadata for
      // a moment while the music carries on. Acting on the instant would either
      // ask about the previous song or abandon a song that is still playing, and
      // both look like losing the lyrics.
      pending = setTimeout(() => {
        pending = undefined;

        if (next === null) {
          requestToken += 1;
          setState({ kind: 'idle' });
          return;
        }

        void requestLyrics(next, false);
      }, METADATA_SETTLE_MS);
    });

    onCleanup(() => {
      if (pending !== undefined) clearTimeout(pending);
      unsubscribe();
    });
  });

  onMount(() => {
    void readPanelVisible().then(setPanelVisible);
    const stopWatching = onPanelVisibleChange(setPanelVisible);
    onCleanup(stopWatching);
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
    if (pipOpen()) return;

    const shell = await openPipShell(`${tokensCss}\n${panelCss}`);
    if (shell === null) return;

    setPipOpen(true);

    // The same component, a second time, against the same signals: the two
    // presentations cannot drift because there is only one source of truth.
    // The refresh control is repeated here because the PiP window has no header
    // to put it in, and a stale empty panel you cannot retry from is the exact
    // trap the panel's own hide button used to be.
    //
    // Into the body, never into a wrapper — `openPipShell` explains why, and its
    // test pins it.
    const dispose = render(
      () => (
        <>
          {/* Decorative, and hidden from the accessibility tree: five drifting
              shapes the stylesheet turns into the backdrop. */}
          <div class="lyrimusic-pip__backdrop" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span class="sweep" />
          </div>

          <div class="lyrimusic-pip__controls">
            <button
              class="lyrimusic__icon-button"
              classList={{ 'is-busy': refreshing() }}
              type="button"
              title="Ask the sources again"
              aria-label="Ask the sources again"
              disabled={refreshing() || track() === null}
              onClick={() => void refresh()}
            >
              <RefreshIcon />
            </button>
          </div>

          <LyricsList state={state} index={index} fraction={fraction} clampHeight={false} />
        </>
      ),
      shell.target,
    );

    shell.window.addEventListener('pagehide', () => {
      dispose();
      setPipOpen(false);
    });
  }

  return (
    <Show when={panelVisible()}>
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
            classList={{ 'is-busy': refreshing() }}
            type="button"
            title="Ask the sources again"
            disabled={refreshing() || track() === null}
            onClick={() => void refresh()}
          >
            <RefreshIcon />
          </button>

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
            title="Hide — bring it back from the toolbar icon"
            onClick={() => void writePanelVisible(false)}
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
          <Show
            when={timed()}
            fallback={<span>Text only — this source carries no timings</span>}
          >
            <span>
              Lyrics {offsetMs() === 0 ? 'in sync' : `${offsetMs() > 0 ? '+' : ''}${offsetMs()} ms`}
            </span>
            <span class="lyrimusic__offset">
              <button
                type="button"
                title="Lyrics 250 ms earlier"
                onClick={() => setOffsetMs((v) => v - OFFSET_STEP_MS)}
              >
                −
              </button>
              <button
                type="button"
                title="Lyrics 250 ms later"
                onClick={() => setOffsetMs((v) => v + OFFSET_STEP_MS)}
              >
                +
              </button>
            </span>
          </Show>
        </footer>
      </section>
    </Show>
  );
}

/**
 * The refresh glyph, shared by the panel and the PiP window so the two cannot
 * drift into different-looking buttons for the same action.
 */
function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
      <path
        d="M20.5 3.5v5h-5"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
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
      fallback={
        <p class="lyrimusic__state">
          {stateMessage(props.state())}
          <Show when={props.state().kind === 'empty'}>
            <span class="lyrimusic__state-hint">Use the refresh button above to ask again</span>
          </Show>
          <Show when={props.state().kind === 'unavailable'}>
            <span class="lyrimusic__state-hint">Reload the YouTube Music tab</span>
          </Show>
        </p>
      }
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
                'is-plain': isPlain(props.state()),
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

function isPlain(state: PanelState): boolean {
  return state.kind === 'ready' && !hasTiming(state.lyrics);
}

function stateMessage(state: PanelState): string {
  switch (state.kind) {
    case 'idle':
      return 'Play something on YouTube Music';
    case 'loading':
      return 'Looking for lyrics…';
    case 'empty':
      return 'No lyrics found';
    case 'unavailable':
      return 'Cannot reach the extension';
    default:
      return '';
  }
}

/**
 * What a reply from the background turned out to be.
 *
 * `stale` is deliberately separate from `none`. An answer that belongs to a
 * different track means "ignore this, nothing is wrong"; a null lyric means
 * "asked, and nobody had it", which is worth telling the user. Collapsing the
 * two is how a panel either keeps the previous song's words on screen or claims
 * a track has no lyrics it was never asked about.
 */
type Answer =
  | { readonly kind: 'lyrics'; readonly lyrics: Lyrics }
  | { readonly kind: 'none' }
  | { readonly kind: 'stale' };

function readAnswer(response: unknown, expectedVideoId: string): Answer {
  if (typeof response !== 'object' || response === null) return { kind: 'stale' };

  const candidate = response as { type?: unknown; videoId?: unknown; lyrics?: unknown };
  if (candidate.type !== 'lyrics/answer') return { kind: 'stale' };
  if (candidate.videoId !== expectedVideoId) return { kind: 'stale' };
  if (typeof candidate.lyrics !== 'object' || candidate.lyrics === null) return { kind: 'none' };

  return { kind: 'lyrics', lyrics: candidate.lyrics as Lyrics };
}
