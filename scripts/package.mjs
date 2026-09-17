#!/usr/bin/env node
/**
 * Builds the ZIP that gets handed to someone else.
 *
 * What a recipient needs is an extension folder they can point a browser at, and
 * a note telling them how. So the build stages a copy of `dist/` rather than
 * zipping it in place — `dist/` stays exactly what an unpacked load expects —
 * and drops a short INSTALL.txt in beside it.
 *
 * Sourcemaps are left out on purpose. They are most of the weight and they are of
 * no use to anyone who is not editing the source; whoever wants them has the
 * repository.
 *
 * This is not a store submission. Nothing here signs, uploads, or produces a
 * `.crx`: a self-signed CRX no longer installs on stable Chrome or Brave, which
 * is why the unpacked folder is the only thing worth shipping.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const STAGE = join(tmpdir(), 'lyri-music-package');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const archive = join(ROOT, `lyri-music-${version}.zip`);

const INSTALL = `LyriMusic ${version}
${'='.repeat(`LyriMusic ${version}`.length)}

Lyrics for YouTube Music, from public community databases. Not affiliated with
Google, YouTube, or YouTube Music.

Requirements
------------
A Chromium browser — Chrome, Brave, Edge, Opera, Arc. Version 116 or newer,
because the picture-in-picture window uses the Document Picture-in-Picture API.

Install
-------
1. Unzip this folder somewhere permanent. Not your Downloads folder: the browser
   reads the files from where they sit, so moving them later breaks the install.

2. In the browser, open:   chrome://extensions    (or brave://extensions)

3. Turn on "Developer mode", top right.

4. Click "Load unpacked" and select the folder you unzipped — the one containing
   manifest.json, which is this folder.

5. Open https://music.youtube.com and play something. A panel appears in the
   bottom-right corner of the page.

Do not drag the .zip onto the extensions page; it takes a signed .crx and will
refuse. Unzip first, then load the folder.

Do not drag this folder onto the extensions page either — a plain folder is not
accepted by drag and drop, only by the "Load unpacked" button.

After installing
----------------
The toolbar icon is settings, not lyrics. It lists the sources the extension may
ask, and carries the switch that shows or hides the panel. The lyrics themselves
live in the page, and in the picture-in-picture window you can pop out from the
panel's header.

Two sources are off by default — KuGou and NetEase. Their access is unofficial,
so the choice to contact them is yours. Turning them on widens what gets found,
especially outside the English catalogue.

Privacy
-------
Nothing is collected. No server, no analytics, no accounts. The only thing that
leaves the machine is a lyrics search — title, artist, album, duration — sent to
the sources you have enabled, for the track you are playing. Everything else
stays in the browser's own local storage.

License
-------
MIT for the source code — see LICENSE beside this file, which travels with the
folder because the license asks to be included in copies. It does not cover song
lyrics, which belong to their respective rights holders and are not distributed
by this project. See NOTICE for that and for the third-party sources.

Known limitation
----------------
The panel finds the current track by reading the page. If YouTube Music changes
its markup, detection can break until that is updated.
`;

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(DIST, STAGE, { recursive: true });
writeFileSync(join(STAGE, 'INSTALL.txt'), INSTALL);

// MIT requires the notice to travel with copies of the software, and the build
// output is a copy. NOTICE comes along because INSTALL.txt points at it.
for (const file of ['LICENSE', 'NOTICE']) {
  cpSync(join(ROOT, file), join(STAGE, file));
}

rmSync(archive, { force: true });
execFileSync('zip', ['-rq', archive, '.', '-x', '*.map'], { cwd: STAGE, stdio: 'inherit' });
rmSync(STAGE, { recursive: true, force: true });

const kb = (statSync(archive).size / 1024).toFixed(0);
console.log(`wrote ${archive} (${kb} KB)`);
