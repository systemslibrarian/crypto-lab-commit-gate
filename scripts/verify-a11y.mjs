// WCAG 2.1 A/AA audit of the live demo using axe-core, across both themes and
// desktop + mobile viewports. Also checks keyboard focus order and touch-target
// sizes (WCAG 2.5.5 / 2.5.8). Usage: node scripts/verify-a11y.mjs [baseURL]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { auditControlNames, formatControlNameFailures } from './control-names.mjs';
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


const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const browser = await chromium.launch();
let totalViolations = 0;

const audit = async (label, viewport, theme) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Exercise the UI so dynamic content (verdicts, bias bars) is also audited.
  await page.click('#e1-commit').catch(() => {});
  await page.click('#e3-run').catch(() => {});
  await page.waitForTimeout(400);

  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  totalViolations += violations.length;
  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this audit clean. See `control-names.mjs`.
  const unnamed = formatControlNameFailures(await auditControlNames(page));
  totalViolations += unnamed.length;
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}, ${theme}) ===`);
  if (!violations.length) {
    console.log('  no WCAG 2.1 A/AA violations');
  } else {
    for (const v of violations) {
      console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
      console.log(`     ${v.helpUrl}`);
    }
  }
  if (unnamed.length) {
    for (const line of unnamed) console.log(`  [name] ${line}`);
  } else {
    console.log('  every form control has a real accessible name');
  }
  await context.close();
};

await audit('desktop', { width: 1100, height: 900 }, 'dark');
await audit('desktop', { width: 1100, height: 900 }, 'light');
await audit('mobile', { width: 390, height: 844 }, 'dark');
await audit('mobile', { width: 390, height: 844 }, 'light');

// --- Touch-target size (WCAG 2.5.5 AAA / 2.5.8 AA = 24px; we target 44px) ---
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
const small = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a, input')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.height < 24 || r.width < 24)) {
      out.push(`${el.tagName.toLowerCase()}#${el.id || '?'} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return out;
});
console.log(`\n=== touch targets (mobile) ===`);
console.log(small.length ? `  TOO SMALL: ${small.join(', ')}` : '  all interactive targets >= 24px');

// --- Keyboard focus order: Tab from the top and record focus stops ---
await page.keyboard.press('Tab'); // skip link
const firstFocus = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
const stops = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  stops.push(await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}` : 'none';
  }));
}
console.log(`\n=== keyboard focus order ===`);
console.log(`  first Tab -> ${firstFocus}`);
console.log(`  next stops: ${stops.join(' -> ')}`);

await browser.close();
stopOwnServer();

console.log(`\n${totalViolations === 0 ? 'PASS' : 'FAIL'}: ${totalViolations} total WCAG violations across all runs`);
process.exit(totalViolations ? 1 : 0);
