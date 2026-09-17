import { describe, expect, it } from 'vitest';
import type { NowPlayingSource, TrackMetadata } from '../src/lib/domain/types';
import { firstAvailable } from '../src/lib/now-playing';

function track(videoId: string, durationMs = 0): TrackMetadata {
  return {
    videoId,
    title: `Invented title ${videoId}`,
    artist: 'Invented artist',
    album: null,
    durationMs,
  };
}

function fakeSource(initial: TrackMetadata | null): {
  source: NowPlayingSource;
  emit: (value: TrackMetadata | null) => void;
} {
  let current = initial;
  let listener: ((value: TrackMetadata | null) => void) | null = null;
  return {
    source: {
      read: () => current,
      positionMs: () => 1234,
      watch: (onChange) => {
        listener = onChange;
        return () => {
          listener = null;
        };
      },
    },
    emit: (value) => {
      current = value;
      listener?.(value);
    },
  };
}

describe('firstAvailable', () => {
  it('reads the first available source', () => {
    const first = fakeSource(track('one'));
    const second = fakeSource(track('two'));

    expect(firstAvailable([first.source, second.source]).read()).toEqual(
      track('one'),
    );
  });

  it('skips a null source', () => {
    const first = fakeSource(null);
    const second = fakeSource(track('two'));

    expect(firstAvailable([first.source, second.source]).read()).toEqual(
      track('two'),
    );
  });

  it('gets position from the source that supplied metadata', () => {
    const first: NowPlayingSource = {
      read: () => track('one'),
      positionMs: () => 111,
      watch: () => () => undefined,
    };
    const second: NowPlayingSource = {
      read: () => track('two'),
      positionMs: () => 222,
      watch: () => () => undefined,
    };

    expect(firstAvailable([first, second]).positionMs()).toBe(111);
  });

  it('delivers the current track immediately when watched', () => {
    const source = fakeSource(track('one'));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));

    expect(changes).toEqual([track('one')]);
  });

  it('reports a duration arriving for the same video, so the lookup can run again', () => {
    // The title and artist are known before the video element knows its length,
    // so the first lookup goes out without a duration. If this update were
    // suppressed, the panel would never ask again for that track.
    const source = fakeSource(track('one'));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));
    source.emit(track('one', 999));

    expect(changes).toEqual([track('one'), track('one', 999)]);
  });

  it('does not report a re-report of the same video and the same duration', () => {
    const source = fakeSource(track('one', 999));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));
    source.emit(track('one', 999));

    expect(changes).toEqual([track('one', 999)]);
  });

  it('reports a title correction for the same video, which is the bug that showed the wrong song', () => {
    // After a song change the url knows the new id before the page knows the new
    // title, so the first report pairs them wrongly. If the correction were
    // suppressed — same id, after all — the lookup made against the previous
    // song's name would stand, and the panel would show the previous lyrics.
    const source = fakeSource(track('new-id'));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));

    const right = { ...track('new-id'), title: 'Invented title, corrected' };
    source.emit(right);

    expect(changes).toEqual([track('new-id'), right]);
  });

  it('does not report a re-report of an identical value', () => {
    // The 500 ms poll re-reads the same metadata constantly; only a genuine
    // change should get through.
    const source = fakeSource(track('one', 999));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));
    source.emit(track('one', 999));

    expect(changes).toHaveLength(1);
  });

  it('reports an artist correction for the same video', () => {
    const source = fakeSource(track('one', 999));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));
    source.emit({ ...track('one', 999), artist: 'Invented artist, corrected' });

    expect(changes).toHaveLength(2);
  });

  it('reports a video change and a track-to-null transition', () => {
    const source = fakeSource(track('one'));
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([source.source]).watch((value) => changes.push(value));
    source.emit(track('two'));
    source.emit(null);

    expect(changes).toEqual([track('one'), track('two'), null]);
  });

  it('stops delivery after the combined unsubscribe', () => {
    const source = fakeSource(track('one'));
    const changes: Array<TrackMetadata | null> = [];
    const unsubscribe = firstAvailable([source.source]).watch((value) =>
      changes.push(value),
    );

    unsubscribe();
    source.emit(track('two'));

    expect(changes).toEqual([track('one')]);
  });

  it('skips throwing reads and keeps watching after a throwing watch', () => {
    const good = fakeSource(track('good'));
    const throwing: NowPlayingSource = {
      read: () => {
        throw new Error('navigation');
      },
      positionMs: () => 0,
      watch: () => {
        throw new Error('navigation');
      },
    };
    const changes: Array<TrackMetadata | null> = [];

    firstAvailable([throwing, good.source]).watch((value) => changes.push(value));
    good.emit(track('better'));

    expect(firstAvailable([throwing, good.source]).read()).toEqual(track('better'));
    expect(changes).toEqual([track('good'), track('better')]);
  });

  it('has neutral behaviour with no sources', () => {
    const source = firstAvailable([]);
    const changes: Array<TrackMetadata | null> = [];

    expect(source.read()).toBeNull();
    expect(source.positionMs()).toBeNull();
    expect(source.watch((value) => changes.push(value))).toBeTypeOf('function');
    expect(changes).toEqual([]);
  });
});
