// WCAG 2.1 A/AA audit of the live demo using axe-core, across both themes and
// desktop + mobile viewports. Also checks keyboard focus order and touch-target
// sizes (WCAG 2.5.5 / 2.5.8). Usage: node scripts/verify-a11y.mjs [baseURL]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.argv[2] ?? 'http://localhost:5176/crypto-lab-commit-gate/';
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
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}, ${theme}) ===`);
  if (!violations.length) {
    console.log('  no WCAG 2.1 A/AA violations');
  } else {
    for (const v of violations) {
      console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
      console.log(`     ${v.helpUrl}`);
    }
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
console.log(`\n${totalViolations === 0 ? 'PASS' : 'FAIL'}: ${totalViolations} total WCAG violations across all runs`);
process.exit(totalViolations ? 1 : 0);
