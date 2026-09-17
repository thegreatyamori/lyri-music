#!/usr/bin/env node
/**
 * Builds the release ZIP from `dist/`.
 *
 * The zip is a convenience for people who would rather not run a Node
 * toolchain; it is not a store submission. Nothing here signs or uploads.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const archive = join(ROOT, `lyri-music-${version}.zip`);

rmSync(archive, { force: true });

execFileSync('zip', ['-rq', archive, '.'], { cwd: DIST, stdio: 'inherit' });

console.log(`wrote ${archive}`);
