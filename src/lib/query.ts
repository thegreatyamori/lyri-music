const TRAILING_NOISE_TAGS = [
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
] as const;

const trailingNoise = new RegExp(
  `\\s*(?:${TRAILING_NOISE_TAGS.map((tag) => `\\(${tag}\\)`).join('|')}|\\[MV\\])\\s*$`,
  'i',
);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function splitArtistPrefix(title: string): { artist: string | null; title: string } {
  const normalized = collapseWhitespace(title);
  const separator = normalized.search(/\s[-–]\s/);

  if (separator < 0) return { artist: null, title: normalized };

  const artist = normalized.slice(0, separator).trim();
  const song = normalized.slice(separator + 3).trim();
  if (artist === '' || song === '') return { artist: null, title: normalized };

  return { artist, title: song };
}

export function forLyricsSearch(title: string): string {
  const original = collapseWhitespace(title);
  let searchable = original;

  while (trailingNoise.test(searchable)) {
    searchable = searchable.replace(trailingNoise, '').trim();
  }

  return searchable === '' ? original : collapseWhitespace(searchable);
}

export function artistForLyricsSearch(artist: string): string {
  const original = collapseWhitespace(artist);
  let searchable = original;

  searchable = searchable.replace(
    /(?:\s*(?:,|&)\s*|\s+)(?:feat\.|ft\.|featuring)\s+.+$/i,
    '',
  );
  searchable = searchable.replace(/\s*-\s*Topic\s*$/i, '');
  searchable = searchable.replace(/(?<=\S)VEVO$/i, '');
  searchable = collapseWhitespace(searchable);

  return searchable === '' ? original : searchable;
}

const TRAILING_BRACKETED = /\s*[([]\s*[^()[\]]*[)\]]$/;
const TRAILING_DASH_SUFFIX = /\s+[-–—]\s+\S.*$/;
const BRACKETED_FEATURED = /\s*[([]\s*(?:feat|ft|featuring|with)\.?\s+[^()[\]]*[)\]]/gi;
const INLINE_FEATURED = /\s+(?:feat|ft|featuring)\.?\s+\S.*$/i;

function stripTrailingBracketed(value: string): string {
  let out = value.trim();
  for (;;) {
    const next = out.replace(TRAILING_BRACKETED, '').trim();
    if (next === out) return out;
    out = next;
  }
}

function stripTrailingDashSuffix(value: string): string {
  return value.replace(TRAILING_DASH_SUFFIX, '').trim();
}

function stripFeatured(value: string): string {
  return value.replace(BRACKETED_FEATURED, '').replace(INLINE_FEATURED, '').trim();
}

/**
 * The title, and progressively looser versions of it.
 *
 * A lyrics database matches on the catalogue name, and the name YouTube Music
 * shows is not always it. "Song (Remastered 2011)" and "Song - Remastered 2011"
 * are the same recording as "Song" to a person and a different string to
 * `/api/get`, which answers 404 — verified, not assumed. The same is true of a
 * featured credit left in the title, and of an album qualifier.
 *
 * The first entry is always the title as it stands, because precision should be
 * tried before forgiveness. The last is the loosest, which is what a caller
 * should fall back to. Nothing is removed from the value the caller already
 * cleans — these are additional attempts, not a replacement.
 *
 * Order is stable and duplicates are dropped, so callers can rely on
 * `variants[0]` being the original and the last entry being the loosest form.
 */
export function titleVariants(title: string): readonly string[] {
  const base = collapseWhitespace(title);
  if (base === '') return [];

  const candidates = [
    base,
    stripTrailingBracketed(base),
    stripFeatured(base),
    stripTrailingDashSuffix(stripTrailingBracketed(stripFeatured(base))),
  ];

  const out: string[] = [];
  for (const candidate of candidates) {
    const value = collapseWhitespace(candidate);
    if (value !== '' && !out.includes(value)) out.push(value);
  }
  return out;
}
