/**
 * The DOM-free HTML reader, exercised on invented markup and invented words.
 *
 * No real page, no real lyrics: the shapes come from Genius's markup (nested
 * divs, `<br>` line breaks, entities) but the content is nonsense on purpose.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  htmlFragmentToText,
  textFromDivsWith,
} from '../src/lib/html-text';

const ATTR = 'data-lyrics-container="true"';

describe('textFromDivsWith', () => {
  it('reads one container', () => {
    expect(textFromDivsWith(`<div ${ATTR}>gromble</div>`, ATTR)).toBe('gromble');
  });

  it('turns <br> into line breaks, in every spelling', () => {
    const html = `<div ${ATTR}>a<br>b<br/>c<br />d</div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('a\nb\nc\nd');
  });

  it('joins every container in document order, which is how Genius splits a song', () => {
    const html = `<div ${ATTR}>one</div><div class="ad">skip</div><div ${ATTR}>two</div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('one\ntwo');
  });

  it('does not stop at a nested div — the case the naive slice gets wrong', () => {
    // Genius wraps annotated fragments in a div inside the lyric container, so
    // the first </div> is not the container's.
    const html = `<div ${ATTR}>first<div class="Annotation">inner</div>last</div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('firstinnerlast');
  });

  it('survives nesting several levels deep', () => {
    const html = `<div ${ATTR}>a<div><div><span>b</span></div></div>c</div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('abc');
  });

  it('ignores a div that does not carry the attribute', () => {
    expect(textFromDivsWith('<div class="other">gromble</div>', ATTR)).toBe('');
  });

  it('does not match an attribute that merely contains the marker', () => {
    const html = '<div data-not-data-lyrics-container="true">gromble</div>';
    expect(textFromDivsWith(html, ATTR)).toBe('');
  });

  it('returns empty rather than throwing on unbalanced markup', () => {
    expect(textFromDivsWith(`<div ${ATTR}>gromble`, ATTR)).toBe('');
  });

  it('ignores a container that holds nothing', () => {
    expect(textFromDivsWith(`<div ${ATTR}></div><div ${ATTR}>flimbo</div>`, ATTR)).toBe('flimbo');
  });

  it('treats block endings as line breaks', () => {
    const html = `<div ${ATTR}><p>one</p><p>two</p></div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('one\ntwo');
  });

  it('drops tags without losing the words inside them', () => {
    const html = `<div ${ATTR}><a href="/x"><span>blorp</span></a></div>`;
    expect(textFromDivsWith(html, ATTR)).toBe('blorp');
  });
});

describe('htmlFragmentToText', () => {
  it('leaves plain text alone', () => {
    expect(htmlFragmentToText('gromble')).toBe('gromble');
  });

  it('keeps non-breaking spaces as spaces, not as line breaks', () => {
    expect(htmlFragmentToText('a&nbsp;b')).toBe('a b');
  });
});

describe('decodeEntities', () => {
  it('decodes the common named entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe(
      'a & b <c> "d" \'e\'',
    );
  });

  it('decodes decimal and hexadecimal code points', () => {
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
  });

  it('handles a curly apostrophe, which is what lyric pages actually use', () => {
    expect(decodeEntities('don&rsquo;t')).toBe('don’t');
  });

  it('leaves an entity it does not know untouched rather than eating it', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('rejects a surrogate code point instead of throwing', () => {
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
  });

  it('rejects a code point beyond the valid range', () => {
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
  });

  it('ignores an ampersand that is not an entity', () => {
    expect(decodeEntities('rock & roll')).toBe('rock & roll');
  });
});
