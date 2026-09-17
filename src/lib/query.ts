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
