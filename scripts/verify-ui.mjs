// Headless click-through of the live demo. Drives every exhibit, asserts the
// interpreted verdicts render correctly, and captures screenshots.
// Usage: node scripts/verify-ui.mjs [baseURL]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5176/crypto-lab-commit-gate/';
const OUT = process.env.SHOT_DIR ?? 'C:/Users/gmcas/AppData/Local/Temp/commit-gate-shots';
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
check('hero h1 present', (await page.locator('h1').innerText()).includes('commit-gate'));
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
  return k === 'ok' || k === 'fail';
}, null, { timeout: 30000 });
check('E2 binding holds (no collision)', (await verdictKind('section[aria-labelledby="exhibit-2-heading"]')) === 'ok');

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
const e5 = await verdictText('section[aria-labelledby="exhibit-5-heading"]');
check('E5 auction winner Bob (31)', e5.includes('Bob') && e5.includes('31'), e5.split('\n')[0]);

// --- A11y: persistent live region exists outside #app ---
const announcerOutsideApp = await page.evaluate(() => {
  const a = document.querySelector('body > [aria-live]');
  return !!a && a.getAttribute('aria-live') === 'polite';
});
check('A11y live-region announcer present outside #app', announcerOutsideApp);

// --- Theme toggle ---
const beforeTheme = await page.getAttribute('html', 'data-theme');
await page.click('#theme-toggle');
const afterTheme = await page.getAttribute('html', 'data-theme');
check('theme toggle switches mode', beforeTheme !== afterTheme, `${beforeTheme} -> ${afterTheme}`);

// Screenshots: light (current), dark, mobile
await page.screenshot({ path: `${OUT}/desktop-light.png`, fullPage: true });
await page.click('#theme-toggle'); // back to dark
await page.screenshot({ path: `${OUT}/desktop-dark.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${OUT}/mobile-dark.png`, fullPage: true });

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
