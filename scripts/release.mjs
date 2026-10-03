#!/usr/bin/env node
/**
 * Cuts a release: bumps the version, verifies it, tags it, pushes it.
 *
 * The release itself is NOT created here. A tag push is what triggers the
 * GitHub Actions workflow, and that workflow builds the zip and attaches it to
 * the release with the token Actions already has. So a release needs no
 * personal access token, no local `gh`, and works the same for anyone who can
 * push a tag.
 *
 * Usage:  pnpm release                 next patch   (0.1.3 → 0.1.4)
 *         pnpm release minor           next minor   (0.1.3 → 0.2.0)
 *         pnpm release major           next major
 *         pnpm release 0.1.4           explicit
 *
 * No argument means patch because that is the boring, frequent case; a release
 * whose size was not thought about should be a one-word override, not a typo
 * the script accepts.
 *
 * The tree must be clean, and the version must be three plain numbers: the
 * manifest only accepts that shape, and a dirty tree would let unrelated work
 * ride along in the release commit.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'], ...options });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

const USAGE = 'usage: pnpm release [major|minor|patch|major.minor.patch]   (default: patch)';

/** 0.1.3 → 0.1.4 / 0.2.0 / 1.0.0, with the components parsed once. */
function bump(version, level) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    console.error(`package.json version "${version}" is not three numbers`);
    process.exit(1);
  }
  const [major = 0, minor = 0, patch = 0] = parts;
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// The three places a version lives. The manifest because the browser reads it,
// the CLIENT_ID because LRCLIB is told who is asking and an outdated id sends
// its diagnosis to the wrong release.
const manifestPath = join(ROOT, 'public/manifest.json');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const previous = pkg.version;

const arg = process.argv[2];
let version;
if (arg === undefined || arg === 'major' || arg === 'minor' || arg === 'patch') {
  version = bump(previous, arg ?? 'patch');
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  version = arg;
} else {
  console.error(USAGE);
  process.exit(1);
}

const tag = `v${version}`;

// A dirty tree means the release commit would either fail or swallow someone
// else's work. Refuse before touching anything.
const status = capture('git', ['status', '--porcelain']);
if (status !== '') {
  console.error('working tree is not clean — commit or stash first');
  process.exit(1);
}

if (capture('git', ['tag', '-l', tag]) !== '') {
  console.error(`tag ${tag} already exists`);
  process.exit(1);
}

pkg.version = version;
writeFileSync(join(ROOT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const lrclibPath = join(ROOT, 'src/lib/providers/lrclib.ts');
const lrclib = readFileSync(lrclibPath, 'utf8');
const nextLrclib = lrclib.replace(/LyriMusic v\d+\.\d+\.\d+/, `LyriMusic v${version}`);
if (nextLrclib === lrclib) {
  console.error('CLIENT_ID in lrclib.ts has no version to replace');
  process.exit(1);
}
writeFileSync(lrclibPath, nextLrclib);

console.log(`bumped ${previous} → ${version}`);

// Verify after the bump: the zip that ships must contain the new manifest, and
// a test suite that passes against the old version number is not the point.
run('pnpm', ['run', 'verify']);

run('git', ['add', 'package.json', 'public/manifest.json', 'src/lib/providers/lrclib.ts']);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
run('git', ['push', 'origin', 'HEAD', tag]);

console.log(`pushed ${tag} — the release workflow runs from here`);
