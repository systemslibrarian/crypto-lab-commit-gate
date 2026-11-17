// Headless click-through of the live demo. Drives every exhibit, asserts the
// interpreted verdicts render correctly, and captures screenshots.
// Usage: node scripts/verify-ui.mjs [baseURL]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Own the server this suite tests.
 *
 * The default used to be http://localhost:5176/, with a preview assumed to be
 * serving it already and no check of whose server answered. 5176 is in vite's
 * dev-server range and the fleet registry
 * (crypto-lab/tools/playwright-ports.json) assigns it to no lab; this lab's
 * port is 4618. A port held by another project answers the goto, and every
 * check after it then describes someone else's page.
 *
 * Pass a base URL as argv[2] to use an already-running server, as before.
 * With no argument this builds if needed, starts its own preview on 4618 with
 * --strictPort -- which refuses to move, so a collision fails loudly here --
 * and stops it by its own pid, never by pattern.
 */
const OWN_PORT = 4618;
const BASE = process.argv[2] ?? `http://localhost:${OWN_PORT}/crypto-lab-commit-gate/`;
let ownServer = null;

async function reachable(u) {
  try {
    return (await fetch(u, { redirect: 'follow' })).ok;
  } catch {
    return false;
  }
}

async function startOwnServer() {
  if (!existsSync(join(REPO_ROOT, 'dist', 'index.html'))) {
    const built = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (built.status !== 0) {
      console.error('FAIL: could not build before starting the preview server');
      console.error((built.stdout ?? '') + (built.stderr ?? ''));
      process.exit(1);
    }
  }
  const child = spawn('npm', ['run', 'preview', '--', '--port', String(OWN_PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    if (await reachable(BASE)) return child;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`FAIL: preview did not come up on port ${OWN_PORT} within 30s.`);
  console.error('      --strictPort does not move, so this is a port collision or a build fault:');
  console.error(log.trim() || '      (the server printed nothing)');
  try {
    if (child.exitCode === null) process.kill(child.pid);
  } catch {
    /* already gone */
  }
  process.exit(1);
}

/* By pid, and only the child this process started -- never by pattern. */
function stopOwnServer() {
  if (ownServer?.exitCode === null) {
    try {
      process.kill(ownServer.pid);
    } catch {
      /* already gone */
    }
  }
}

if (!process.argv[2]) ownServer = await startOwnServer();


const OUT = process.env.SHOT_DIR ?? 'commit-gate-shots';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// Hero renders
check('hero h1 present', (await page.locator('h1').innerText()).includes('Commitment Schemes'));
check('primer lifecycle present', await page.locator('.primer-flow').isVisible());

const verdictText = async (sel) => (await page.locator(sel).locator('.verdict').last().innerText()).trim();
const verdictKind = async (scope) =>
  page.locator(`${scope} .verdict`).last().getAttribute('data-kind');

// --- Exhibit 1: honest open ---
await page.fill('#e1-message', '42');
await page.click('#e1-commit');
await page.waitForSelector('#e1-open');
await page.click('#e1-open');
await page.waitForFunction(() =>
  document.querySelector('#exhibit-1-heading')?.closest('.exhibit')?.querySelector('.verdict')?.getAttribute('data-kind') === 'ok');
check('E1 honest open accepted', (await verdictKind('section[aria-labelledby="exhibit-1-heading"]')) === 'ok');

// --- Exhibit 1: cheat attempt ---
await page.fill('#e1-message', '42');
await page.click('#e1-commit');
await page.waitForSelector('#e1-reveal');
await page.fill('#e1-reveal', '999');
await page.click('#e1-open');
await page.waitForFunction(() =>
  document.querySelector('#exhibit-1-heading')?.closest('.exhibit')?.querySelector('.verdict')?.getAttribute('data-kind') === 'fail');
const e1cheat = await verdictText('section[aria-labelledby="exhibit-1-heading"]');
check('E1 cheat rejected', (await verdictKind('section[aria-labelledby="exhibit-1-heading"]')) === 'fail', e1cheat.split('\n')[0]);

// --- Exhibit 2: binding ---
await page.click('#e2-binding');
await page.waitForFunction(() => {
  const k = document.querySelector('#exhibit-2-heading')?.closest('.exhibit')?.querySelector('.verdict')?.getAttribute('data-kind');
  return k === 'info' || k === 'fail';
}, null, { timeout: 30000 });
check('E2 bounded search did not find a collision', (await verdictKind('section[aria-labelledby="exhibit-2-heading"]')) === 'info');

// --- Exhibit 3: hiding + bias bars ---
await page.click('#e3-run');
await page.waitForSelector('.bias-viz .bias-fill', { timeout: 30000 });
const bars = await page.locator('.bias-viz .bias-fill').count();
check('E3 bias bars rendered', bars === 2, `${bars} bars`);

// --- Exhibit 3: broken + dictionary attack ---
await page.fill('#e3-broken-message', 'yes');
await page.click('#e3-broken-commit');
await page.click('#e3-dictionary');
await page.waitForFunction(() =>
  document.querySelector('#exhibit-3-heading')?.closest('.exhibit')?.querySelectorAll('.verdict')[1]?.getAttribute('data-kind') === 'fail');
check('E3 dictionary attack recovers secret', true);

// --- Exhibit 4: Pedersen open + homomorphic ---
await page.fill('#e4-m1', '12');
await page.fill('#e4-m2', '31');
await page.click('#e4-commit-open');
await page.waitForFunction(() =>
  document.querySelector('#exhibit-4-heading')?.closest('.exhibit')?.querySelector('.verdict')?.getAttribute('data-kind') === 'ok', null, { timeout: 30000 });
await page.click('#e4-homomorphic');
await page.waitForFunction(() => {
  const vs = document.querySelector('#exhibit-4-heading')?.closest('.exhibit')?.querySelectorAll('.verdict');
  return vs?.[1]?.getAttribute('data-kind') === 'ok';
}, null, { timeout: 30000 });
const e4 = await verdictText('section[aria-labelledby="exhibit-4-heading"]');
check('E4 homomorphic sum verified', e4.includes('43'), e4.split('\n').find((l) => l.includes('43')) ?? '');

// --- Exhibit 5: auction ---
await page.click('#e5-commit');
await page.click('#e5-reveal');
await page.waitForFunction(() =>
  document.querySelector('#exhibit-5-heading')?.closest('.exhibit')?.querySelector('.verdict')?.getAttribute('data-kind') === 'ok');
const auctionVerdict = await page.locator('section[aria-labelledby="exhibit-5-heading"] .verdict').first().innerText();
check('E5 auction winner Bob (31)', auctionVerdict.includes('Bob') && auctionVerdict.includes('31'), auctionVerdict.split('\n')[0]);

// --- A11y: persistent live region exists outside #app ---
const announcerOutsideApp = await page.evaluate(() => {
  const a = document.querySelector('body > [aria-live]');
  return !!a && a.getAttribute('aria-live') === 'polite';
});
check('A11y live-region announcer present outside #app', announcerOutsideApp);

// --- Theme: dark is the only one, pinned before first paint, no way to leave it.
// This used to click #theme-toggle and assert the theme changed. That button and
// its handler are gone, so what is left to check is that the pin holds.
const theme = await page.getAttribute('html', 'data-theme');
check('theme pinned to dark', theme === 'dark', String(theme));
check(
  'no theme control renders',
  (await page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
    .count()) === 0
);

// Screenshots: desktop, mobile
await page.screenshot({ path: `${OUT}/desktop-dark.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${OUT}/mobile-dark.png`, fullPage: true });

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
stopOwnServer();

console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
