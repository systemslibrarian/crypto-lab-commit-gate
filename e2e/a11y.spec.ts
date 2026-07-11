import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the commitment-scheme
 * unit tests; this gates them on accessibility the same way. Scans the full
 * page in both the dark (default) and light themes.
 *
 * This lab renders all exhibits inline — there are no <details> and no
 * class-toggled tab panels — but we still expand any <details> and reveal any
 * class-toggled panels defensively so future additions are covered, and we
 * neutralize any reveal animation so panels are scanned fully settled.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Expand any native disclosure widgets.
    for (const details of document.querySelectorAll('details')) {
      (details as HTMLDetailsElement).open = true;
    }
    // Neutralize any reveal animation/opacity fade so class-toggled panels are
    // scanned in their settled, fully-opaque state rather than mid-transition.
    const style = document.createElement('style');
    style.textContent =
      '.panel, .panel.active, [hidden] { animation: none !important; transition: none !important; opacity: 1 !important; }';
    document.head.appendChild(style);
    // Reveal any class-toggled panels/accordions so hidden content is scanned.
    for (const panel of document.querySelectorAll('.panel')) {
      panel.classList.add('active');
      panel.removeAttribute('hidden');
    }
  });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await revealAll(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await revealAll(page);
  await scan(page);
});
