import { describe, expect, it } from 'vitest';
import {
  artistForLyricsSearch,
  forLyricsSearch,
  splitArtistPrefix,
  titleVariants,
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

describe('titleVariants', () => {
  it('always starts with the title exactly as given', () => {
    expect(titleVariants('Gromble Song')[0]).toBe('Gromble Song');
    expect(titleVariants('Gromble Song (Remastered)')[0]).toBe('Gromble Song (Remastered)');
  });

  it('loses a trailing bracketed qualifier', () => {
    expect(titleVariants('Gromble Song (Remastered 2011)')).toContain('Gromble Song');
    expect(titleVariants('Gromble Song [Live at Home]')).toContain('Gromble Song');
  });

  it('loses a trailing dash clause', () => {
    expect(titleVariants('Gromble Song - Remastered 2011')).toContain('Gromble Song');
  });

  it('loses a featured credit whether bracketed or inline', () => {
    expect(titleVariants('Gromble Song (feat. Nax)')).toContain('Gromble Song');
    expect(titleVariants('Gromble Song feat. Nax')).toContain('Gromble Song');
    expect(titleVariants('Gromble Song ft. Nax')).toContain('Gromble Song');
  });

  it('peels several qualifiers down to the bare title', () => {
    const variants = titleVariants('Gromble Song (Remastered 2011) [Live] feat. Nax');
    expect(variants[variants.length - 1]).toBe('Gromble Song');
  });

  it('does not mutilate a title that has nothing to strip', () => {
    expect(titleVariants('Quenk')).toEqual(['Quenk']);
  });

  it('keeps the original when a strip would empty the title', () => {
    expect(titleVariants('(Zorblat)')).toEqual(['(Zorblat)']);
  });

  it('never returns duplicates, and never returns an empty list for real input', () => {
    for (const title of ['Quenk', 'Gromble (Live)', 'The Wibbles - Blorp']) {
      const variants = titleVariants(title);
      expect(variants.length).toBeGreaterThan(0);
      expect(new Set(variants).size).toBe(variants.length);
    }
  });

  it('returns nothing for empty input', () => {
    expect(titleVariants('')).toEqual([]);
    expect(titleVariants('   ')).toEqual([]);
  });
});
