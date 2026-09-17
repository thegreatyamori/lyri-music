import { describe, expect, it } from 'vitest';
import {
  artistForLyricsSearch,
  forLyricsSearch,
  splitArtistPrefix,
} from '../src/lib/query';

describe('splitArtistPrefix', () => {
  it('splits hyphen-minus and en dash artist prefixes', () => {
    expect(splitArtistPrefix(' Zorblat Q. - Gromble Song ')).toEqual({
      artist: 'Zorblat Q.',
      title: 'Gromble Song',
    });
    expect(splitArtistPrefix('The Wibbles – Quenk Tune')).toEqual({
      artist: 'The Wibbles',
      title: 'Quenk Tune',
    });
  });

  it('does not split a hyphenated word', () => {
    expect(splitArtistPrefix('Grom-ble')).toEqual({
      artist: null,
      title: 'Grom-ble',
    });
  });

  it('collapses whitespace and falls back when a split is incomplete', () => {
    expect(splitArtistPrefix('  Zorblat   -   Gromble   ')).toEqual({
      artist: 'Zorblat',
      title: 'Gromble',
    });
    expect(splitArtistPrefix('  -  ')).toEqual({ artist: null, title: '-' });
  });
});

describe('forLyricsSearch', () => {
  it('strips every supported trailing noise tag', () => {
    const tags = [
      'Official Video',
      'Official Music Video',
      'Official Audio',
      'Official Lyric Video',
      'Lyric Video',
      'Lyrics',
      'Audio',
      'Visualizer',
      'Music Video',
      'MV',
      'M/V',
      'Color Coded Lyrics',
      'Color Coded Lyrics Eng Rom',
      'Performance Video',
      'Live',
      'Official',
      'HD',
      'HQ',
      '4K',
      'Video',
    ];

    for (const tag of tags) {
      expect(forLyricsSearch(`  Gromble Tune (${tag.toLowerCase()})  `)).toBe('Gromble Tune');
    }
    expect(forLyricsSearch('Gromble Tune [MV]')).toBe('Gromble Tune');
  });

  it('strips several tags repeatedly and collapses whitespace', () => {
    expect(forLyricsSearch('  Gromble   Tune (Official Video) (HD) (MV)  ')).toBe(
      'Gromble Tune',
    );
  });

  it('falls back to the original when tags would empty the title', () => {
    expect(forLyricsSearch(' (Official Video) ')).toBe('(Official Video)');
  });
});

describe('artistForLyricsSearch', () => {
  it('removes Topic, glued VEVO, and feature suffixes', () => {
    expect(artistForLyricsSearch('Zorblat Q. - Topic')).toBe('Zorblat Q.');
    expect(artistForLyricsSearch('ZorblatVEVO')).toBe('Zorblat');
    expect(artistForLyricsSearch('Gromble Feat. Nax')).toBe('Gromble');
    expect(artistForLyricsSearch('Gromble, ft. Nax')).toBe('Gromble');
    expect(artistForLyricsSearch('Gromble,featuring Nax')).toBe('Gromble');
    expect(artistForLyricsSearch('Gromble & featuring Nax')).toBe('Gromble');
  });

  it('collapses whitespace and falls back when cleaning would empty it', () => {
    expect(artistForLyricsSearch('  The   Wibbles   ')).toBe('The Wibbles');
    expect(artistForLyricsSearch('VEVO')).toBe('VEVO');
    expect(artistForLyricsSearch('The Wibbles VEVO')).toBe('The Wibbles VEVO');
    expect(artistForLyricsSearch('  Gromble   -   Topic  ')).toBe('Gromble');
  });
});
