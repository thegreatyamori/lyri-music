/**
 * The shared name comparison, exercised on invented names.
 *
 * Two providers depend on this and neither has a duration precise enough to
 * overrule a bad match, so the shape of the agreement rules is load-bearing.
 */

import { describe, expect, it } from 'vitest';
import { namesAgree, normalizeName } from '../src/lib/name-match';

describe('normalizeName', () => {
  it('lowercases, drops punctuation and collapses separators', () => {
    expect(normalizeName("Don't Stop")).toBe('don t stop');
    expect(normalizeName('  Gromble   —   Song ')).toBe('gromble song');
    expect(normalizeName('Zorblat;Zorblat')).toBe('zorblat zorblat');
  });

  it('returns empty for input that is only punctuation', () => {
    expect(normalizeName('---')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });

  it('keeps digits and non-Latin scripts', () => {
    expect(normalizeName('Track 2')).toBe('track 2');
    expect(normalizeName('夜に駆ける')).toBe('夜に駆ける');
  });
});

describe('namesAgree', () => {
  it('agrees on an exact match after normalising', () => {
    expect(namesAgree('Wibble Song', 'wibble  song!')).toBe(true);
  });

  it('agrees when one side is decorated by the provider', () => {
    expect(namesAgree('Wibble Song;Wibble Song', 'Wibble Song')).toBe(true);
    expect(namesAgree('The Wibbles feat. Nax', 'The Wibbles')).toBe(true);
  });

  it('agrees either way round, because providers store names in both directions', () => {
    expect(namesAgree('Zorblat Q. - Gromble', 'Gromble')).toBe(true);
    expect(namesAgree('Gromble', 'Zorblat Q. - Gromble')).toBe(true);
  });

  it('disagrees on unrelated names', () => {
    expect(namesAgree('Wibble Song', 'Something Else')).toBe(false);
    expect(namesAgree('The Wibbles', 'Another Band')).toBe(false);
  });

  it('never agrees with an empty side, rather than matching everything', () => {
    expect(namesAgree('', 'Wibble Song')).toBe(false);
    expect(namesAgree('Wibble Song', '')).toBe(false);
    expect(namesAgree('   ', '---')).toBe(false);
  });
});
