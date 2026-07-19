// Publishes seveneves.ai/mde for the version in package.json: the browser
// build to /mde/app/, installer mirrors to /mde/updates/ (what the landing
// page's download modal links to), and the landing page's version constants.
//
// Runs ONLY on the dev PC (the [self-hosted, mde-windows] runner): it stages
// through the local site checkout at S:\sevenevesai — keeping it in sync with
// what is live — and uploads over the machine's `seveneves` SSH alias, so no
// deploy credentials live in GitHub. Idempotent; safe to rerun.
//
// Expects dist-web/ to be freshly built and the GitHub release v<version> to
// already carry all installers (release.yml orders this job after every build
// job). The desktop auto-updater does NOT use these mirrors — it reads
// latest.json from GitHub releases.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist-web';
const SITE = 'S:/sevenevesai/public_html/mde';
const REPO = 'sevenevesai/MDE';
const REMOTE = 'seveneves'; // ~/.ssh/config alias (Namecheap shared hosting)
const REMOTE_DIR = 'public_html/mde'; // home-relative on the host
const LIVE = 'https://seveneves.ai/mde';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

// The landing page's download modal builds exactly these filenames from its
// VERSION constant — the mirror set and the modal must stay in step.
const installers = [
  `MDE_${version}_x64-setup.exe`,
  `MDE_${version}_x64_en-US.msi`,
  `MDE_${version}_aarch64.dmg`,
  `MDE_${version}_x64.dmg`,
  `MDE_${version}_amd64.AppImage`,
  `MDE_${version}_amd64.deb`,
  `MDE-${version}-1.x86_64.rpm`,
];

function patch(file, pattern, replacement) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(replacement)) return; // already applied
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`${file}: no match for ${pattern}`);
  fs.writeFileSync(file, next);
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: SITE });
}

// 1. Swap vite's stock head for the site's: real favicons + analytics loader.
patch(
  path.join(DIST, 'index.html'),
  '<link rel="icon" type="image/svg+xml" href="./vite.svg" />',
  '<link rel="icon" type="image/png" sizes="32x32" href="/mde/icons/32.png">\n    <link rel="icon" type="image/png" sizes="64x64" href="/mde/icons/64.png">'
);
patch(
  path.join(DIST, 'index.html'),
  '<title>MDE</title>',
  '<title>MDE</title>\n    <script src="/ins/i.js" defer></script>'
);

// 2. Mirror the fresh build into the site checkout.
const appDir = path.join(SITE, 'app');
fs.rmSync(appDir, { recursive: true, force: true });
fs.cpSync(DIST, appDir, { recursive: true });

// 3. Installer mirrors from the GitHub release (public repo — no auth).
//    Version-embedded filenames, so an existing file is already this release's.
for (const name of installers) {
  const dest = path.join(SITE, 'updates', name);
  if (fs.existsSync(dest)) continue;
  const url = `https://github.com/${REPO}/releases/download/v${version}/${name}`;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// 4. Landing page names the version in its download modal and its JSON-LD.
patch(path.join(SITE, 'index.html'), /const VERSION = '[^']+'/, `const VERSION = '${version}'`);
patch(path.join(SITE, 'index.html'), /"softwareVersion": "[^"]+"/, `"softwareVersion": "${version}"`);

// 5. Upload. The app dir goes up under a temp name and is swapped in via mv
//    so a half-copied tree is never served.
run('ssh', [REMOTE, `rm -rf ${REMOTE_DIR}/app.new ${REMOTE_DIR}/app.old`]);
run('scp', ['-r', 'app', `${REMOTE}:${REMOTE_DIR}/app.new`]);
run('ssh', [
  REMOTE,
  `[ ! -d ${REMOTE_DIR}/app ] || mv ${REMOTE_DIR}/app ${REMOTE_DIR}/app.old && mv ${REMOTE_DIR}/app.new ${REMOTE_DIR}/app && rm -rf ${REMOTE_DIR}/app.old`,
]);
run('scp', [...installers.map((n) => `updates/${n}`), `${REMOTE}:${REMOTE_DIR}/updates/`]);
run('scp', ['index.html', `${REMOTE}:${REMOTE_DIR}/index.html`]);

// 6. Smoke-check what is actually live (plain fetch on purpose: if the host
//    ever challenges non-browser clients, downloads would be broken too).
const entry = fs
  .readFileSync(path.join(appDir, 'index.html'), 'utf8')
  .match(/assets\/index-[\w-]+\.js/)[0];
const liveApp = await (await fetch(`${LIVE}/app/`)).text();
if (!liveApp.includes(entry)) throw new Error(`live app index does not reference ${entry}`);
const liveLanding = await (await fetch(`${LIVE}/`)).text();
if (!liveLanding.includes(`const VERSION = '${version}'`))
  throw new Error('live landing page still reports an old version');
const head = await fetch(`${LIVE}/updates/${installers[0]}`, { method: 'HEAD' });
if (!head.ok) throw new Error(`installer mirror missing: ${head.status} ${installers[0]}`);
console.log(`site publish verified: ${LIVE} -> v${version}`);
