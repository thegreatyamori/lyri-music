/**
 * Comparing a catalogue name with whatever YouTube reported.
 *
 * Two providers need this and for the same reason: their search will happily
 * return a row that shares one word with the query, and neither offers a
 * duration precise enough to overrule it. What is left is the name, and a name
 * comparison has to survive "Don't Stop" against "dont stop", a curly
 * apostrophe, and an artist credited as "The Wibbles feat. Nax" against
 * "The Wibbles".
 *
 * Containment counts either way, because providers store names in both
 * directions: one row calls the track "Creep;Creep" and another calls it
 * "Radiohead - Creep", and both are the same recording.
 */

/** Case- and punctuation-insensitive, with runs of separators collapsed. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when either name, normalised, contains the other. */
export function namesAgree(first: string, second: string): boolean {
  const a = normalizeName(first);
  const b = normalizeName(second);
  if (a === '' || b === '') return false;
  return a.includes(b) || b.includes(a);
}
