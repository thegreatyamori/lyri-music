#!/usr/bin/env node
/**
 * The mechanical half of the "no lyrics in the repository" rule.
 *
 * The rule exists because hosting lyrics is what turns a lyrics client into a
 * redistribution problem. The code that fetches them is a tool; a fixture with
 * real lyrics is a copy. Discipline is not enough to enforce that, so this
 * runs in `verify` and fails the build.
 *
 * It can only catch the obvious shapes — an `.lrc` file, an oversized fixture.
 * It is a floor, not a guarantee. See CONTRIBUTING.md.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const FORBIDDEN = new Set(['.lrc', '.lrcx', '.ttml']);
/** A fixture above this size is almost certainly somebody's real lyrics. */
const MAX_FIXTURE_BYTES = 4096;

const problems = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    const rel = relative(ROOT, path);
    const ext = extname(entry.name).toLowerCase();

    if (FORBIDDEN.has(ext)) {
      problems.push(`${rel} — a ${ext} file must never be committed`);
      continue;
    }

    if (rel.startsWith('tests/fixtures/')) {
      const size = (await stat(path)).size;
      if (size > MAX_FIXTURE_BYTES) {
        problems.push(`${rel} — ${size} bytes; fixtures this large are probably real lyrics`);
      }
    }
  }
}

await walk(ROOT);

if (problems.length > 0) {
  console.error('check-no-lyrics: refusing to continue\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nUse invented text. See CONTRIBUTING.md.');
  process.exit(1);
}

console.log('check-no-lyrics: clean');
