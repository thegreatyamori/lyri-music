// @vitest-environment happy-dom

/**
 * The two NowPlaying adapters, against a fake page.
 *
 * These exist because DOM detection has been the source of one bug after
 * another, and every one of them was found by a person playing music rather than
 * by a test. The page here is not YouTube Music; it is the smallest shape that
 * exercises the paths that broke — above all the one where the url stops naming
 * the track while the music keeps playing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackMetadata } from '../src/lib/domain/types';
import {
  createDomSource,
  createMediaSessionSource,
  createNowPlaying,
} from '../src/content/now-playing';

interface MediaSessionMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
}

function setMediaSession(metadata: MediaSessionMetadata | null): void {
  Object.defineProperty(navigator, 'mediaSession', {
    value: metadata === null ? undefined : { metadata },
    configurable: true,
  });
}

function playerBar(options: { title?: string; byline?: string; watchHref?: string }): void {
  const byline = options.byline ?? '';
  const anchor = options.watchHref ?? '';
  document.body.innerHTML = [
    '<ytmusic-player-bar>',
    options.title === undefined ? '' : `<span class="title">${options.title}</span>`,
    byline === '' ? '' : `<span class="byline">${byline}</span>`,
    anchor === '' ? '' : `<a href="${anchor}"></a>`,
    '</ytmusic-player-bar>',
  ].join('');
}

function navigateTo(url: string): void {
  history.replaceState({}, '', url);
}

/** happy-dom does not implement `duration` or `currentTime` on a video element. */
function fakeVideo(duration: number, currentTime = 0): void {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: duration, configurable: true });
  Object.defineProperty(video, 'currentTime', { value: currentTime, configurable: true });
  document.body.append(video);
}

function read(source: { read: () => TrackMetadata | null }): TrackMetadata | null {
  return source.read();
}

beforeEach(() => {
  document.body.innerHTML = '';
  setMediaSession(null);
  navigateTo('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createMediaSessionSource', () => {
  it('takes the track from the Media Session and the id from the url', () => {
    setMediaSession({ title: 'Invented Title', artist: 'Invented Artist', album: 'Invented Album' });
    navigateTo('/watch?v=abc123');

    expect(read(createMediaSessionSource())).toEqual({
      videoId: 'abc123',
      title: 'Invented Title',
      artist: 'Invented Artist',
      album: 'Invented Album',
      durationMs: 0,
    });
  });

  it('keeps reading the track after the player is minimised and the url drops the id', () => {
    // The bug: collapsing the player navigates away from /watch?v=… while the
    // music keeps playing. Reading the url alone reported "nothing is playing"
    // and the panel lost the lyrics of a song you could still hear.
    setMediaSession({ title: 'Invented Title', artist: 'Invented Artist', album: 'Invented Album' });
    playerBar({ title: 'Invented Title', byline: 'Invented Artist', watchHref: '/watch?v=abc123' });
    navigateTo('/');

    const track = read(createMediaSessionSource());

    expect(track?.videoId).toBe('abc123');
    expect(track?.title).toBe('Invented Title');
  });

  it('still reports the track when neither the url nor the player bar names it', () => {
    setMediaSession({ title: 'Invented Title', artist: 'Invented Artist', album: '' });
    navigateTo('/');

    const track = read(createMediaSessionSource());

    // A derived id: none of the providers needs a video id, it only keys the
    // cache, and half a panel is worse than a made-up key.
    expect(track?.videoId).toMatch(/^derived:/);
    expect(track?.album).toBeNull();
  });

  it('reports nothing when there is no metadata at all', () => {
    navigateTo('/watch?v=abc123');

    expect(read(createMediaSessionSource())).toBeNull();
  });

  it('reads the duration from the video element', () => {
    setMediaSession({ title: 'Invented Title', artist: 'Invented Artist', album: '' });
    navigateTo('/watch?v=abc123');
    fakeVideo(239.5, 12);

    expect(read(createMediaSessionSource())?.durationMs).toBe(239_500);
  });
});

describe('createDomSource', () => {
  it('reads the title and splits the byline into artist and album', () => {
    playerBar({
      title: 'Invented Title',
      byline: 'Invented Artist • Invented Album • 2011',
      watchHref: '/watch?v=abc123',
    });
    navigateTo('/watch?v=abc123');

    expect(read(createDomSource())).toEqual({
      videoId: 'abc123',
      title: 'Invented Title',
      artist: 'Invented Artist',
      album: 'Invented Album',
      durationMs: 0,
    });
  });

  it('survives the url losing the id, taking it from the player bar link', () => {
    playerBar({
      title: 'Invented Title',
      byline: 'Invented Artist',
      watchHref: '/watch?v=abc123',
    });
    navigateTo('/');

    expect(read(createDomSource())?.videoId).toBe('abc123');
  });

  it('survives a byline with no separator', () => {
    playerBar({ title: 'Invented Title', byline: 'Invented Artist', watchHref: '/watch?v=a' });
    navigateTo('/');

    const track = read(createDomSource());
    expect(track?.artist).toBe('Invented Artist');
    expect(track?.album).toBeNull();
  });

  it('reports nothing when the player bar is absent', () => {
    navigateTo('/watch?v=abc123');

    expect(read(createDomSource())).toBeNull();
  });
});

describe('createNowPlaying', () => {
  it('prefers the Media Session when both adapters can see a track', () => {
    setMediaSession({ title: 'From Media Session', artist: 'Invented Artist', album: '' });
    playerBar({ title: 'From The Dom', byline: 'Invented Artist', watchHref: '/watch?v=abc' });
    navigateTo('/watch?v=abc');

    expect(read(createNowPlaying())?.title).toBe('From Media Session');
  });

  it('falls back to the player bar when the Media Session is empty', () => {
    playerBar({ title: 'From The Dom', byline: 'Invented Artist', watchHref: '/watch?v=abc' });
    navigateTo('/watch?v=abc');

    expect(read(createNowPlaying())?.title).toBe('From The Dom');
  });
});
