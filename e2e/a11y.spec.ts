import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

/**
 * WCAG regression gate. Deploys are already gated on the commitment-scheme unit
 * tests and on the on-screen claims (`claims.spec.ts`); this gates them on
 * accessibility the same way.
 *
 * Three things this gate used to be unable to see, and now can:
 *
 *  1. The page is drawn by `main.ts` into an empty `#app`. Scanning straight
 *     after `page.goto` can scan the empty container and pass having checked
 *     nothing, so every scan now waits for the shell to be painted first.
 *
 *  2. It only ever scanned the untouched page. Every verdict panel — the ok,
 *     fail and info tints, the auction table, the recovered-secret panel — had
 *     never been scanned at all. The states below drive each one and scan there.
 *
 *  3. It asserted only on `results.violations`. axe files two defect classes
 *     this lab is exposed to under `incomplete`, where the assertion never saw
 *     them: contrast it declines to compute, and a name it had to discard. Both
 *     are asserted on now, and contrast is additionally measured arithmetically
 *     by `./contrast`, which composites the translucent verdict tints over the
 *     card underneath instead of guessing at the surface.
 *
 * Motion is settled by emulating `prefers-reduced-motion: reduce` — which this
 * lab's own CSS honours — and then waiting for `document.getAnimations()` to go
 * quiet. It is NOT settled by injecting `transition: none`, which would leave
 * the suite structurally unable to see a transition or theme-swap defect.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * axe rules whose "incomplete" bucket hides real failures rather than genuine
 * ambiguity, so the gate treats them as violations:
 *  - color-contrast: axe gives up (rather than failing) on gradients and some
 *    composited backgrounds, which is exactly what this lab's verdict tints are;
 *  - the aria-* name rules: `aria-label`/`aria-labelledby` on an element ARIA
 *    gives no role is *prohibited*, so the name is silently discarded.
 */
const INCOMPLETE_IS_FAILURE = /^(color-contrast|aria-)/;

/**
 * The two places axe's abstention is a limit of axe rather than a hidden
 * failure, and the gate lets it through:
 *
 *  - `nonBmp`: the element's text is a single symbol glyph (the ☀/☾ on the theme
 *    toggle, the → between flow steps) and axe cannot tell a glyph from an icon
 *    font;
 *  - anything inside an <svg>: the Exhibit 4 diagram's labels sit on a canvas
 *    axe cannot resolve a background for, so it reports `imgNode`/`bgOverlap`
 *    for every one of them no matter what colour they are.
 *
 * Neither is a skip. `auditContrast` measures both — including reading `fill`
 * rather than `color` for SVG text, which is what those labels actually paint
 * with — so they get a harder answer than the one axe declined to give.
 *
 * Note what is deliberately NOT here: `bgImage`/`bgGradient` on an HTML
 * element. That is the reason a gradient background hid two real AA failures in
 * a sibling lab, so it must keep reaching the assertion.
 */
const UNDECIDABLE_CONTRAST_KEYS = new Set(['nonBmp']);

/* ------------------------------------------------------------------ waits */

/**
 * Hold until nothing is animating for several consecutive frames.
 *
 * Consecutive frames, not one sample: a theme flip does not drain in a single
 * batch — the first wave of colour transitions ends and later ones start, so a
 * single "nothing running right now" reading can be taken through a gap between
 * waves and scan a half-blended background.
 */
async function settle(page: Page, frames = 6): Promise<void> {
  await page.waitForFunction(
    (needed: number) =>
      new Promise<boolean>((resolve) => {
        let clear = 0;
        let budget = 600;
        const tick = (): void => {
          const running = document
            .getAnimations()
            .some((a) => a.playState === 'running' || a.playState === 'pending');
          clear = running ? 0 : clear + 1;
          if (clear >= needed) {
            resolve(true);
            return;
          }
          if (--budget <= 0) {
            resolve(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
    { timeout: 20_000 }
  );
}

/**
 * Load the lab with motion reduced and the shell actually painted.
 *
 * `test.use({ reducedMotion })` is a silent no-op on the pinned Playwright
 * (1.61.1), so the emulation is applied explicitly and then proved from inside
 * the page — an unasserted media emulation that quietly stopped working would
 * take the whole motion-settling story down with it and nothing would fail.
 */
async function open(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  const reduced = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  expect(reduced, 'reduced-motion emulation must actually be in effect').toBe(true);
  // main.ts renders the whole page into an empty #app, so a scan that ran
  // before the render would report a clean page it never looked at. Measured on
  // this lab, that race does not currently happen: `main.ts` is a deferred
  // module that renders synchronously on execution, so by the time `goto`
  // resolves at `load` the exhibits are already in the DOM. This wait is the
  // guard that keeps it that way — the day any exhibit starts painting from a
  // promise, the gate blocks rather than quietly scanning an empty div.
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('.verdict').first()).toBeVisible();
  await settle(page);
}

/** Expand disclosures so hidden content is scanned too. */
async function revealAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) {
      (details as HTMLDetailsElement).open = true;
    }
    for (const panel of document.querySelectorAll('.panel')) {
      panel.classList.add('active');
      panel.removeAttribute('hidden');
    }
  });
  await settle(page);
}

/* ------------------------------------------------------------------ scans */

async function scan(page: Page, label: string): Promise<void> {
  await revealAll(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(violations, `axe violations — ${label}`).toEqual([]);

  const candidates = results.incomplete
    .filter((v) => INCOMPLETE_IS_FAILURE.test(v.id))
    .flatMap((v) =>
      v.nodes
        .filter(
          (n) =>
            ![...n.any, ...n.all, ...n.none].every((c) =>
              UNDECIDABLE_CONTRAST_KEYS.has(String((c.data as { messageKey?: string })?.messageKey))
            )
        )
        .map((n) => ({ id: v.id, help: v.help, target: n.target.join(' ') }))
    );

  const svgTargets = new Set(
    await page.evaluate(
      (targets: string[]) =>
        targets.filter((t) => {
          const el = document.querySelector(t);
          return !!el && !!el.closest('svg');
        }),
      candidates.map((c) => c.target)
    )
  );
  const blockingIncomplete = candidates.filter((c) => !svgTargets.has(c.target));
  expect(blockingIncomplete, `axe could not clear these — ${label}`).toEqual([]);

  // Everything else axe left undecided is logged, not asserted: it is a lead to
  // read, not a verdict, and failing on it would make the gate un-actionable.
  const rest = results.incomplete.filter((v) => !INCOMPLETE_IS_FAILURE.test(v.id));
  if (rest.length) {
    console.log(`[axe incomplete, informational] ${label}: ${rest.map((v) => v.id).join(', ')}`);
  }

  const contrast = await auditContrast(page);
  expect(formatContrastFailures(contrast), `measured contrast — ${label}`).toEqual([]);
}

/* ----------------------------------------------------------------- states */

/**
 * Each entry drives the page into a state a visitor can actually reach and
 * leaves it there. Every driver ends on an assertion about the rendered result,
 * so a scan never samples a state before the async crypto behind it has landed.
 */
type State = {
  name: string;
  drive: (page: Page) => Promise<void>;
};

const verdict = (page: Page, n: number) =>
  page.locator(`section[aria-labelledby="exhibit-${n}-heading"] .verdict`).first();

/**
 * Match a verdict by its rendered headline. Scoped to `.verdict-head` on
 * purpose: the same sentence is also pushed into the page's persistent
 * `role="status"` live region, so a bare text match resolves to two nodes.
 */
const headline = (page: Page, text: string) => page.locator('.verdict-head', { hasText: text });

const STATES: State[] = [
  {
    name: 'exhibit 1 — commitment sealed (info verdict)',
    drive: async (page) => {
      await page.locator('#e1-commit').click();
      await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'info');
    },
  },
  {
    name: 'exhibit 1 — honest opening accepted (ok verdict)',
    drive: async (page) => {
      await page.locator('#e1-commit').click();
      await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'info');
      await page.locator('#e1-open').click();
      await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'ok');
    },
  },
  {
    name: 'exhibit 1 — cheating opening rejected (fail verdict)',
    drive: async (page) => {
      await page.locator('#e1-commit').click();
      await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'info');
      await page.locator('#e1-reveal').fill('99');
      await page.locator('#e1-open').click();
      await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'fail');
    },
  },
  {
    name: 'exhibit 2 — binding search reported, meter advanced',
    drive: async (page) => {
      await page.locator('#e2-binding').click();
      await expect(verdict(page, 2)).toHaveAttribute('data-kind', /info|fail/);
    },
  },
  {
    name: 'exhibit 3 — hiding sample with bias bars drawn',
    drive: async (page) => {
      await page.locator('#e3-run').click();
      await expect(verdict(page, 3)).toHaveAttribute('data-kind', /ok|info/);
    },
  },
  {
    name: 'exhibit 3 — infinite-compute attacker contrast',
    drive: async (page) => {
      await page.locator('#e3-run').click();
      await expect(verdict(page, 3)).toHaveAttribute('data-kind', /ok|info/);
      await page.locator('#e3-attacker-toggle').click();
      await expect(page.locator('#e3-attacker-toggle')).toHaveAttribute('aria-pressed', 'true');
    },
  },
  {
    name: 'exhibit 3 — unblinded commitment built (info verdict)',
    drive: async (page) => {
      await page.locator('#e3-broken-commit').click();
      await expect(headline(page, 'Unblinded commitment built')).toBeVisible();
    },
  },
  {
    name: 'exhibit 3 — dictionary attack recovers the secret (fail verdict)',
    drive: async (page) => {
      await page.locator('#e3-broken-commit').click();
      await expect(headline(page, 'Unblinded commitment built')).toBeVisible();
      await page.locator('#e3-dictionary').click();
      await expect(headline(page, 'Secret recovered')).toBeVisible();
    },
  },
  {
    name: 'exhibit 3 — dictionary attack misses (out-of-order guard)',
    drive: async (page) => {
      await page.locator('#e3-dictionary').click();
      await expect(headline(page, 'Build the unblinded commitment first')).toBeVisible();
    },
  },
  {
    name: 'exhibit 4 — Pedersen opening verified (ok verdict)',
    drive: async (page) => {
      await page.locator('#e4-commit-open').click();
      await expect(verdict(page, 4)).toHaveAttribute('data-kind', 'ok');
    },
  },
  {
    name: 'exhibit 4 — homomorphic sum verified, diagram drawn',
    drive: async (page) => {
      await page.locator('#e4-homomorphic').click();
      await expect(page.locator('section[aria-labelledby="exhibit-4-heading"] svg')).toBeVisible();
    },
  },
  {
    name: 'exhibit 5 — bids sealed (info verdict)',
    drive: async (page) => {
      await page.locator('#e5-commit').click();
      await expect(verdict(page, 5)).toHaveAttribute('data-kind', 'info');
    },
  },
  {
    name: 'exhibit 5 — bids revealed and winner declared (ok verdict)',
    drive: async (page) => {
      await page.locator('#e5-commit').click();
      await expect(verdict(page, 5)).toHaveAttribute('data-kind', 'info');
      await page.locator('#e5-reveal').click();
      await expect(verdict(page, 5)).toHaveAttribute('data-kind', 'ok');
    },
  },
  {
    name: 'exhibit 5 — reveal before commit (out-of-order guard)',
    drive: async (page) => {
      await page.locator('#e5-reveal').click();
      await expect(headline(page, 'Publish commitments first')).toBeVisible();
    },
  },
];

/** Drive every exhibit at once, for the scans that want the page at its richest. */
async function driveEverything(page: Page): Promise<void> {
  await page.locator('#e1-commit').click();
  await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'info');
  await page.locator('#e1-open').click();
  await expect(verdict(page, 1)).toHaveAttribute('data-kind', 'ok');
  await page.locator('#e2-binding').click();
  await expect(verdict(page, 2)).toHaveAttribute('data-kind', /info|fail/);
  await page.locator('#e3-run').click();
  await expect(verdict(page, 3)).toHaveAttribute('data-kind', /ok|info/);
  await page.locator('#e3-broken-commit').click();
  await expect(headline(page, 'Unblinded commitment built')).toBeVisible();
  await page.locator('#e3-dictionary').click();
  await expect(headline(page, 'Secret recovered')).toBeVisible();
  await page.locator('#e4-homomorphic').click();
  await expect(page.locator('section[aria-labelledby="exhibit-4-heading"] svg')).toBeVisible();
  await page.locator('#e5-commit').click();
  await expect(verdict(page, 5)).toHaveAttribute('data-kind', 'info');
  await page.locator('#e5-reveal').click();
  await expect(verdict(page, 5)).toHaveAttribute('data-kind', 'ok');
  await settle(page);
}

/* ------------------------------------------------------------------ tests */

test('no WCAG A/AA violations at rest, dark theme', async ({ page }) => {
  await open(page);
  await scan(page, 'at rest / dark');
});


for (const state of STATES) {
  test(`no WCAG A/AA violations — ${state.name}, dark theme`, async ({ page }) => {
    await open(page);
    await state.drive(page);
    await settle(page);
    await scan(page, `${state.name} / dark`);
  });

}

test('no WCAG A/AA violations with every exhibit driven, dark theme', async ({ page }) => {
  await open(page);
  await driveEverything(page);
  await scan(page, 'everything driven / dark');
});


/**
 * Narrow viewport, rich state.
 *
 * This lab has several `overflow-x: auto` containers — the equation blocks, the
 * 64-hex commitment rows, the auction table. A container that scrolls but holds
 * nothing focusable is a WCAG 2.1.1 keyboard trap (`scrollable-region-focusable`),
 * and it can only become one once there is content in it AND the viewport is
 * narrow enough to make it scroll, so a scan of the untouched page at 1280px
 * could never fail no matter what changed.
 *
 * Measured today, none of them actually overflow at 380px: `overflow-wrap:
 * anywhere` breaks the hex strings and the layout reflows instead. That is the
 * lab being right, not the check being pointless — the checked-in state is now
 * held there, and the first `white-space: nowrap` that turns one of these into
 * a real scroller fails this test instead of shipping.
 *
 * The reflow assertion is the same idea for WCAG 1.4.10, which axe does not
 * check at all: nothing may push the document wider than the viewport.
 */
for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations at 380px with every exhibit driven, ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await open(page);
    await driveEverything(page);
    await scan(page, `380px / everything driven / ${theme}`);

    const reflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const overflowing = Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > vw + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`)
        .slice(0, 10);
      return { documentWidth: document.documentElement.scrollWidth, viewport: vw, overflowing };
    });
    expect(reflow.overflowing, `elements wider than a 380px viewport / ${theme}`).toEqual([]);
    expect(reflow.documentWidth, `document must not scroll sideways / ${theme}`).toBeLessThanOrEqual(
      reflow.viewport
    );
  });
}

