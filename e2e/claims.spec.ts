import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Functional gate for the claims this lab makes on screen.
 *
 * The a11y spec proves the page is reachable; this one proves it is RIGHT.
 * The vitest suite covers `hashcommit.ts` and `pedersen.ts` in isolation, but
 * nothing covered the layer a visitor actually reads: the interpreted verdicts,
 * the counters, the binding meter, the bias bars, the auction winner, or the
 * homomorphism SVG (`homomorphism-viz.ts` had no test at all). Those are all
 * rendered by `main.ts` from live crypto, so only a browser can check them.
 *
 * The strongest assertions here are the cross-path ones — places where the page
 * computes the same quantity twice and the two renderings must agree:
 *   - published C (envelope) vs published C (verdict row) vs recomputed C on open
 *   - C₁ + C₂ point  vs  C(m₁+m₂) point            (Exhibit 4 verdict rows)
 *   - the verdict's "Sum of messages" vs the SVG's own C(m₁+m₂=…) label
 *   - the SVG's tip-to-tail C₂ endpoint vs the resultant arrow's endpoint
 *   - the bias bars' percentages vs the separately rendered |Δ| row
 *   - the binding meter's tally vs the verdict headline vs the verdict row
 * and the one place ground truth is available to the test: the unblinded
 * commitment is literally SHA-256(m), so Node recomputes it independently.
 */

/* ---------------------------------------------------------------- helpers */

const exhibit = (page: Page, n: number): Locator =>
  page.locator(`section[aria-labelledby="exhibit-${n}-heading"]`);

const verdictOf = (page: Page, n: number, index = 0): Locator =>
  exhibit(page, n).locator('.verdict').nth(index);

/** Verdict headline with the decorative status glyph stripped. */
const headlineOf = async (verdict: Locator): Promise<string> =>
  ((await verdict.locator('.verdict-head').textContent()) ?? '').replace(/^[✓✕ℹ·]\s*/u, '').trim();

const detailOf = async (verdict: Locator): Promise<string> =>
  ((await verdict.locator('.verdict-detail').textContent()) ?? '').trim();

/** The verdict's <dl> as a label → value map. */
const rowsOf = async (verdict: Locator): Promise<Record<string, string>> => {
  const items = verdict.locator('.verdict-rows > div');
  const count = await items.count();
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    const label = ((await items.nth(i).locator('dt').textContent()) ?? '').trim();
    const value = ((await items.nth(i).locator('dd').textContent()) ?? '').trim();
    out[label] = value;
  }
  return out;
};

/** Parse a page-rendered integer that may carry thousands separators. */
const int = (text: string): number => Number.parseInt(text.replace(/,/g, ''), 10);

const sha256Hex = (message: string): string =>
  createHash('sha256').update(message, 'utf8').digest('hex');

/* ------------------------------------------------- Exhibit 1: commit/open */

test('Exhibit 1 seals a commitment and renders the same C everywhere it appears', async ({
  page
}) => {
  await page.goto('.');
  const e1 = exhibit(page, 1);
  const verdict = verdictOf(page, 1);

  await expect(e1.locator('.envelope')).toHaveClass(/sealed/);
  await expect(e1.locator('.envelope')).not.toHaveClass(/opened/);

  const message = await e1.locator('#e1-message').inputValue();
  await e1.locator('#e1-commit').click();
  await expect(verdict).toContainText('Sealed.');

  expect(await headlineOf(verdict)).toBe('Sealed. Commitment published to Bob.');
  await expect(verdict).toHaveAttribute('data-kind', 'info');

  const rows = await rowsOf(verdict);
  // The verdict echoes the message the user actually typed, not a fixed string.
  expect(rows['Committed m']).toBe(message);
  // 32-byte values rendered truncated at 40 hex chars.
  expect(rows['Blinding r']).toMatch(/^[0-9a-f]{40}…$/);
  expect(rows['Published C']).toMatch(/^[0-9a-f]{40}…$/);
  expect(rows['Published C']).not.toBe(rows['Blinding r']);

  // Cross-render agreement: the envelope and the verdict must show one C.
  const envelopeC = e1.locator('.envelope-row', { hasText: 'Published C' }).locator('.mono');
  expect((await envelopeC.textContent())?.trim()).toBe(rows['Published C']);

  // "A fresh blinding factor r is generated for you" — recommitting the same
  // message must produce a different r and therefore a different C.
  await e1.locator('#e1-commit').click();
  await expect
    .poll(async () => (await rowsOf(verdictOf(page, 1)))['Published C'])
    .not.toBe(rows['Published C']);
  expect((await rowsOf(verdictOf(page, 1)))['Blinding r']).not.toBe(rows['Blinding r']);
});

test('Exhibit 1 accepts an honest opening and recomputes the published C', async ({ page }) => {
  await page.goto('.');
  const e1 = exhibit(page, 1);

  await e1.locator('#e1-commit').click();
  await expect(verdictOf(page, 1)).toContainText('Sealed.');
  const publishedC = (await rowsOf(verdictOf(page, 1)))['Published C'];

  const revealed = await e1.locator('#e1-reveal').inputValue();
  await e1.locator('#e1-open').click();
  await expect(verdictOf(page, 1)).toContainText('accepts');

  const verdict = verdictOf(page, 1);
  expect(await headlineOf(verdict)).toBe('Bob accepts the opening.');
  await expect(verdict).toHaveAttribute('data-kind', 'ok');
  expect(await detailOf(verdict)).toContain('equals the published C');

  const rows = await rowsOf(verdict);
  expect(rows['Revealed m']).toBe(revealed);
  // Cross-path: the C recomputed at open time is the C published at commit time.
  expect(rows['Recomputed C']).toBe(publishedC);

  await expect(e1.locator('.envelope')).toHaveClass(/opened/);
});

test('Exhibit 1 rejects an opening to a different message, and says why', async ({ page }) => {
  await page.goto('.');
  const e1 = exhibit(page, 1);

  await e1.locator('#e1-message').fill('42');
  await e1.locator('#e1-commit').click();
  await expect(verdictOf(page, 1)).toContainText('Sealed.');

  await e1.locator('#e1-reveal').fill('99');
  await e1.locator('#e1-open').click();
  await expect(verdictOf(page, 1)).toContainText('rejects');

  const verdict = verdictOf(page, 1);
  expect(await headlineOf(verdict)).toBe('Bob rejects — cheating detected.');
  await expect(verdict).toHaveAttribute('data-kind', 'fail');

  // The failure must explain itself with both concrete values, not just fail.
  const detail = await detailOf(verdict);
  expect(detail).toContain('You committed "42" but tried to open "99"');
  expect(detail).toContain('A different message hashes to a different C');
  expect(detail).toContain('binding');

  const rows = await rowsOf(verdict);
  expect(rows['Committed m']).toBe('42');
  expect(rows['Tried to reveal']).toBe('99');

  // Binding rejects the swap, not the exhibit: the honest opening still verifies.
  await e1.locator('#e1-reveal').fill('42');
  await e1.locator('#e1-open').click();
  await expect(verdictOf(page, 1)).toHaveAttribute('data-kind', 'ok');
  expect(await headlineOf(verdictOf(page, 1))).toBe('Bob accepts the opening.');
});

/* -------------------------------------------- Exhibit 2: binding, counted */

const SPACE_LOG10 = 128 * Math.log10(2); // ≈ 2^128 birthday bound, in decades

/** The meter's own formula: how many leading zeros tries/2^128 renders with. */
const expectedFraction = (tries: number): string => {
  const zeros = Math.min(Math.max(0, Math.floor(SPACE_LOG10 - Math.log10(tries)) - 1), 34);
  return `0.${'0'.repeat(zeros)}…%`;
};

test('Exhibit 2 tallies every batch consistently across headline, row and meter', async ({
  page
}) => {
  test.setTimeout(120_000);
  await page.goto('.');
  const e2 = exhibit(page, 2);
  const button = e2.locator('#e2-binding');

  // The batch size the button advertises is the increment we must observe.
  const batch = int(((await button.textContent()) ?? '').match(/batch of ([\d,]+)/)?.[1] ?? '0');
  expect(batch).toBeGreaterThan(0);

  await expect(e2.locator('.binding-meter')).toHaveCount(0);

  await button.click();
  await expect(verdictOf(page, 2)).toContainText('tried so far', { timeout: 90_000 });

  const readTally = async (): Promise<{ headline: number; row: number; meter: number }> => {
    const verdict = verdictOf(page, 2);
    const headline = int((await headlineOf(verdict)).match(/\(([\d,]+) tried so far\)/)?.[1] ?? '');
    const row = int((await rowsOf(verdict))['Total messages tried']);
    const note = ((await e2.locator('.meter-note').textContent()) ?? '').replace(/\s+/g, ' ');
    // Anchor to the phrase — the note carries several other numbers.
    const meter = int(note.match(/You have tried ([\d,]+) of roughly/)?.[1] ?? '');
    return { headline, row, meter };
  };

  const first = await readTally();
  expect(first.row).toBe(batch);
  expect(first.headline).toBe(first.row);
  expect(first.meter).toBe(first.row);
  expect((await rowsOf(verdictOf(page, 2)))['Collisions found']).toBe('0');
  await expect(verdictOf(page, 2)).toHaveAttribute('data-kind', 'info');

  // The rendered fraction is the tally divided by the 2^128 bound it claims.
  const firstFraction = ((await e2.locator('.meter-frac').textContent()) ?? '').trim();
  expect(firstFraction).toBe(expectedFraction(first.row));

  await button.click();
  await expect(verdictOf(page, 2)).toContainText(`${(batch * 2).toLocaleString()} tried so far`, {
    timeout: 90_000
  });

  const second = await readTally();
  expect(second.row).toBe(first.row + batch);
  expect(second.headline).toBe(second.row);
  expect(second.meter).toBe(second.row);
  expect((await rowsOf(verdictOf(page, 2)))['Collisions found']).toBe('0');

  const secondFraction = ((await e2.locator('.meter-frac').textContent()) ?? '').trim();
  expect(secondFraction).toBe(expectedFraction(second.row));
  // More work done can never mean a smaller fraction covered.
  const zeros = (s: string): number => (s.match(/0/g) ?? []).length;
  expect(zeros(secondFraction)).toBeLessThanOrEqual(zeros(firstFraction));
  // ...and the fraction really is vanishing, which is the exhibit's point.
  expect(zeros(firstFraction)).toBeGreaterThanOrEqual(30);

  // The meter is anchored to the birthday bound and to a time cost, not to the
  // user's batch.
  const note = ((await e2.locator('.meter-note').textContent()) ?? '').replace(/\s+/g, ' ');
  expect(note).toContain('2¹²⁸ ≈ 3.4 × 10³⁸');
  const years = Math.pow(2, 128) / 1e9 / (60 * 60 * 24 * 365);
  const superscript = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const exponent = String(Math.floor(Math.log10(years)))
    .split('')
    .map((d) => superscript[Number(d)])
    .join('');
  expect(note).toContain(`10${exponent}`);
  expect(note).toContain('far longer than the age of the universe');
});

/* ------------------------------------------------------ Exhibit 3: hiding */

test('Exhibit 3 bias bars, |Δ| row and verdict all describe the same sample', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('.');
  const e3 = exhibit(page, 3);

  await e3.locator('#e3-run').click();
  await expect(e3.locator('.bias-viz')).toBeVisible({ timeout: 90_000 });
  await expect(verdictOf(page, 3, 0)).toContainText('fresh commitments each', { timeout: 90_000 });

  const verdict = verdictOf(page, 3, 0);
  const detail = await detailOf(verdict);
  const samples = int(detail.match(/Across ([\d,]+) fresh commitments each/)?.[1] ?? '');
  expect(samples).toBeGreaterThan(0);

  // Each bar renders its own percentage AND sets its fill width from it.
  const bars = await e3.locator('.bias-row').evaluateAll((rows) =>
    rows.map((row) => ({
      label: row.querySelector('.bias-label')?.textContent?.trim() ?? '',
      value: row.querySelector('.bias-value')?.textContent?.trim() ?? '',
      width: (row.querySelector('.bias-fill') as HTMLElement | null)?.style.width ?? ''
    }))
  );
  expect(bars).toHaveLength(2);
  expect(bars[0].label).toContain('m=0');
  expect(bars[1].label).toContain('m=1');
  for (const bar of bars) {
    expect(bar.value).toMatch(/^\d{1,3}\.\d%$/);
    // The drawn bar must be as long as the number printed beside it. (Compared
    // numerically: the CSSOM normalizes "48.0%" back out to "48%".)
    expect(bar.width).toMatch(/^[\d.]+%$/);
    expect(Number.parseFloat(bar.width)).toBe(Number.parseFloat(bar.value));
  }

  // Each printed percentage must be a genuine count/samples ratio: recover the
  // count, re-render it with the page's own toFixed(1), and demand the string back.
  const countFrom = (pct: string): number =>
    Math.round((Number.parseFloat(pct) / 100) * samples);
  const zeroCount = countFrom(bars[0].value);
  const oneCount = countFrom(bars[1].value);
  expect(((zeroCount / samples) * 100).toFixed(1) + '%').toBe(bars[0].value);
  expect(((oneCount / samples) * 100).toFixed(1) + '%').toBe(bars[1].value);
  expect(zeroCount).toBeGreaterThanOrEqual(0);
  expect(zeroCount).toBeLessThanOrEqual(samples);
  expect(oneCount).toBeGreaterThanOrEqual(0);
  expect(oneCount).toBeLessThanOrEqual(samples);

  // The separately rendered |Δ| row must be the gap between those two counts.
  const rows = await rowsOf(verdict);
  const delta = Number.parseFloat(rows['Bias gap |Δ|']);
  expect(Math.round(delta * samples)).toBe(Math.abs(zeroCount - oneCount));
  expect(Math.abs(delta - Math.abs(zeroCount - oneCount) / samples)).toBeLessThan(1e-4);

  // The prose repeats all three numbers; they must be the same three numbers.
  expect(detail).toContain(`was ${bars[0].value} for m=0 and ${bars[1].value} for m=1`);
  expect(detail).toContain(
    `The gap of ${((Math.abs(zeroCount - oneCount) / samples) * 100).toFixed(1)}%`
  );

  // The verdict must match its own threshold, whichever side of it this run lands on.
  const kind = await verdict.getAttribute('data-kind');
  const headline = await headlineOf(verdict);
  if (delta < 0.1) {
    expect(kind).toBe('ok');
    expect(headline).toBe('Indistinguishable — an observer cannot tell 0 from 1.');
  } else {
    expect(kind).toBe('info');
    expect(headline).toBe('Sampling noise this run; rerun for a tighter result.');
  }
  // A blinded SHA-256 commitment cannot bias one bit this far: |Δ| > 0.25 is
  // ~8 standard deviations at 512 samples, so this bound is effectively certain.
  expect(delta).toBeLessThan(0.25);

  // Two sampled commitments to different values must not look alike.
  expect(rows['A sample C(0)']).toMatch(/^[0-9a-f]{40}…$/);
  expect(rows['A sample C(1)']).toMatch(/^[0-9a-f]{40}…$/);
  expect(rows['A sample C(0)']).not.toBe(rows['A sample C(1)']);
});

test('Exhibit 3 infinite-compute attacker breaks hash hiding but not Pedersen', async ({
  page
}) => {
  test.setTimeout(120_000);
  await page.goto('.');
  const e3 = exhibit(page, 3);

  await expect(e3.locator('.hiding-contrast')).toHaveCount(0);
  await e3.locator('#e3-run').click();
  await expect(e3.locator('.hiding-contrast')).toBeVisible({ timeout: 90_000 });

  const hashCard = e3.locator('.contrast-card[data-prim="hash"]');
  const pedersenCard = e3.locator('.contrast-card[data-prim="pedersen"]');
  const toggle = e3.locator('#e3-attacker-toggle');

  // Bounded attacker: both primitives hide.
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(hashCard).not.toHaveClass(/is-broken/);
  await expect(hashCard.locator('.contrast-badge')).toHaveClass(/badge-safe/);
  await expect(hashCard).toContainText('Against a real (bounded) attacker: safe');
  await expect(pedersenCard).toContainText('perfectly hidden');
  await expect(hashCard).toContainText('Computational hiding');
  await expect(pedersenCard).toContainText('Information-theoretic hiding');

  await toggle.click();

  // Unlimited compute: the hash commitment falls, and the panel says why.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(hashCard).toHaveClass(/is-broken/);
  await expect(hashCard.locator('.contrast-badge')).toHaveClass(/badge-broken/);
  await expect(hashCard).toContainText(
    'Against UNLIMITED compute: broken in principle — the attacker inverts the hash and reads m.'
  );
  // Pedersen must NOT break — that asymmetry is the whole lesson.
  await expect(pedersenCard).not.toHaveClass(/is-broken/);
  await expect(pedersenCard.locator('.contrast-badge')).toHaveClass(/badge-safe/);
  await expect(pedersenCard).toContainText(
    'Against UNLIMITED compute: STILL perfectly hidden — no amount of computation helps.'
  );
  await expect(e3.locator('.hiding-contrast .hint')).toContainText(
    'the hash commitment falls'
  );

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(hashCard).not.toHaveClass(/is-broken/);
});

test('Exhibit 3 unblinded commitment is really SHA-256(m) and is deterministic', async ({
  page
}) => {
  await page.goto('.');
  const e3 = exhibit(page, 3);
  const verdict = verdictOf(page, 3, 1);

  // The attack refuses to run before there is anything to attack.
  await e3.locator('#e3-dictionary').click();
  await expect(verdict).toContainText('Build the unblinded commitment first.');

  const secret = await e3.locator('#e3-broken-message').inputValue();
  await e3.locator('#e3-broken-commit').click();
  await expect(verdict).toContainText('Unblinded commitment built');

  const shown = (await rowsOf(verdict))['C = SHA-256(m)'];
  // Ground truth: Node recomputes the digest independently of the browser.
  expect(shown).toBe(`${sha256Hex(secret).slice(0, 40)}…`);

  // No blinding means no hiding: the same message always yields the same C.
  await e3.locator('#e3-broken-commit').click();
  await expect(verdict).toContainText('Unblinded commitment built');
  expect((await rowsOf(verdictOf(page, 3, 1)))['C = SHA-256(m)']).toBe(shown);
});

test('Exhibit 3 dictionary attack recovers the secret and counts its guesses', async ({ page }) => {
  await page.goto('.');
  const e3 = exhibit(page, 3);
  const verdict = verdictOf(page, 3, 1);

  const secret = await e3.locator('#e3-broken-message').inputValue();
  await e3.locator('#e3-broken-commit').click();
  await expect(verdict).toContainText('Unblinded commitment built');
  await e3.locator('#e3-dictionary').click();
  await expect(verdict).toContainText('Secret recovered');

  expect(await headlineOf(verdict)).toBe(`Secret recovered: "${secret}".`);
  await expect(verdict).toHaveAttribute('data-kind', 'fail');

  const rows = await rowsOf(verdict);
  const dictSize = int(rows['Dictionary size']);
  const guesses = int(rows['Guesses to break']);
  expect(guesses).toBeGreaterThan(0);
  // You cannot need more guesses than the dictionary holds.
  expect(guesses).toBeLessThanOrEqual(dictSize);
  // The prose count must be the counted count.
  expect(await detailOf(verdict)).toContain(`matched yours after ${guesses} guess`);
  expect(await detailOf(verdict)).toContain('A random r would have made this attack hopeless');

  // A secret outside the dictionary survives THIS attack but is still not hiding.
  await e3.locator('#e3-broken-message').fill('an-unguessed-secret-value');
  await e3.locator('#e3-broken-commit').click();
  await expect(verdict).toContainText('Unblinded commitment built');
  await e3.locator('#e3-dictionary').click();
  await expect(verdict).toContainText('Not in this dictionary');

  expect(await headlineOf(verdict)).toBe('Not in this dictionary — but still not hiding.');
  const missDetail = await detailOf(verdict);
  expect(missDetail).toContain(`not among the ${dictSize} common candidates`);
  expect(missDetail).toContain('the commitment is still deterministic');
});

/* ---------------------------------------------------- Exhibit 4: Pedersen */

test('Exhibit 4 opens a Pedersen commitment to the message the user typed', async ({ page }) => {
  await page.goto('.');
  const e4 = exhibit(page, 4);
  const verdict = verdictOf(page, 4, 0);

  // The README's binding claim must be stated on the page.
  await expect(e4.locator('.callout-binding')).toContainText('hash-to-curve');
  await expect(e4.locator('.callout-binding')).toContainText(
    'nobody may know the discrete log of'
  );

  await e4.locator('#e4-m1').fill('12');
  await e4.locator('#e4-commit-open').click();
  await expect(verdict).toContainText('point checks out');

  expect(await headlineOf(verdict)).toBe('Opened m₁ = 12 and the point checks out.');
  await expect(verdict).toHaveAttribute('data-kind', 'ok');
  expect(await detailOf(verdict)).toContain('log_G(H) is unknown');

  let rows = await rowsOf(verdict);
  expect(rows['Message scalar m']).toBe('12');
  expect(rows['Commitment C']).toMatch(/^\([0-9a-f]+/);

  // The verdict tracks the input rather than repeating a fixed number.
  await e4.locator('#e4-m1').fill('7');
  await e4.locator('#e4-commit-open').click();
  await expect(verdictOf(page, 4, 0)).toContainText('Opened m₁ = 7');
  rows = await rowsOf(verdictOf(page, 4, 0));
  expect(rows['Message scalar m']).toBe('7');
});

test('Exhibit 4 adds commitments and both computations land on one point', async ({ page }) => {
  await page.goto('.');
  const e4 = exhibit(page, 4);
  const verdict = verdictOf(page, 4, 1);

  const check = async (m1: string, m2: string): Promise<void> => {
    await e4.locator('#e4-m1').fill(m1);
    await e4.locator('#e4-m2').fill(m2);
    await e4.locator('#e4-homomorphic').click();
    const expectedSum = String(Number(m1) + Number(m2));
    await expect(verdictOf(page, 4, 1)).toContainText(`= ${expectedSum}.`);

    const v = verdictOf(page, 4, 1);
    await expect(v).toHaveAttribute('data-kind', 'ok');

    // The headline states its own arithmetic; it must add up and match the inputs.
    const headline = await headlineOf(v);
    const parts = headline.match(/opens to (\d+) \+ (\d+) = (\d+)\.$/);
    expect(parts).not.toBeNull();
    expect(parts?.[1]).toBe(m1);
    expect(parts?.[2]).toBe(m2);
    expect(Number(parts?.[3])).toBe(Number(parts?.[1]) + Number(parts?.[2]));

    const rows = await rowsOf(v);
    expect(rows['Sum of messages']).toBe(expectedSum);
    // THE assertion: the page derives this point twice — once by adding the two
    // sealed commitments, once by committing afresh to the summed opening. If
    // the homomorphism did not hold, these two strings would differ.
    expect(rows['C₁ + C₂ point']).toBe(rows['C(m₁+m₂) point']);
    expect(rows['C₁ + C₂ point']).toMatch(/^\([0-9a-f]+/);

    // Cross-module: the schematic SVG must be drawn for the same numbers the
    // curve arithmetic just produced.
    const svg = e4.locator('.homo-svg');
    await expect(svg).toBeVisible();
    const labels = await svg.locator('text').allTextContents();
    expect(labels).toContain(`C₁ (m=${m1})`);
    expect(labels).toContain(`C₂ (m=${m2})`);
    expect(labels).toContain(`C(m₁+m₂=${rows['Sum of messages']})`);
    expect(await svg.getAttribute('aria-label')).toContain(
      `lands on the commitment to their sum ${rows['Sum of messages']}`
    );

    // Geometry: C₂ is drawn tip-to-tail from C₁, and the resultant arrow ends
    // exactly where C₂ ends. "Lands exactly on" is the figcaption's claim.
    const lines: Record<string, Record<string, string | null>> = await svg
      .locator('line')
      .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [
          el.getAttribute('class') ?? '',
          {
            x1: el.getAttribute('x1'),
            y1: el.getAttribute('y1'),
            x2: el.getAttribute('x2'),
            y2: el.getAttribute('y2')
          }
        ])
      )
    );
    expect(lines['hv-c2'].x1).toBe(lines['hv-c1'].x2);
    expect(lines['hv-c2'].y1).toBe(lines['hv-c1'].y2);
    expect(lines['hv-sum'].x1).toBe(lines['hv-c1'].x1);
    expect(lines['hv-sum'].y1).toBe(lines['hv-c1'].y1);
    expect(lines['hv-sum'].x2).toBe(lines['hv-c2'].x2);
    expect(lines['hv-sum'].y2).toBe(lines['hv-c2'].y2);
    // ...and the resultant is a real arrow, not a degenerate point.
    expect(lines['hv-sum'].x2).not.toBe(lines['hv-sum'].x1);
  };

  await check('12', '31');
  await check('5', '9');
});

/* -------------------------------------------- Exhibit 5: sealed-bid auction */

type Row = { bidder: string; bid: string };

const auctionRows = (page: Page): Promise<Row[]> =>
  exhibit(page, 5)
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => ({
        bidder: (tr.children[0]?.textContent ?? '').trim(),
        bid: (tr.children[2]?.textContent ?? '').trim()
      }))
    );

test('Exhibit 5 seals every bid, then reveals the true winner', async ({ page }) => {
  await page.goto('.');
  const e5 = exhibit(page, 5);
  const verdict = verdictOf(page, 5);

  // Revealing before committing is refused, not silently ignored.
  await e5.locator('#e5-reveal').click();
  await expect(verdict).toContainText('Publish commitments first.');

  const runAuction = async (bids: Record<string, string>): Promise<void> => {
    for (const [who, amount] of Object.entries(bids)) {
      await e5.locator(`#e5-bid-${who}`).fill(amount);
    }
    await e5.locator('#e5-commit').click();
    await expect(verdictOf(page, 5)).toContainText('sealed and published simultaneously');

    // One table row per bidder input — the table claims the whole field.
    const bidderCount = await e5.locator('input[id^="e5-bid-"]').count();
    expect(bidderCount).toBe(Object.keys(bids).length);
    let rows = await auctionRows(page);
    expect(rows).toHaveLength(bidderCount);
    // Every bid is hidden before the reveal; none leaks its number.
    for (const row of rows) {
      expect(row.bid).toBe('🔒 sealed');
    }
    // Every commitment is distinct even when two bids are not.
    const commitments = await e5
      .locator('tbody tr td.mono')
      .evaluateAll((tds) => tds.map((td) => td.textContent?.trim() ?? ''));
    expect(new Set(commitments).size).toBe(bidderCount);

    await e5.locator('#e5-reveal').click();
    await expect(verdictOf(page, 5)).toContainText('Winner:');

    rows = await auctionRows(page);
    // Each revealed bid matches the number that bidder actually entered.
    for (const row of rows) {
      expect(row.bid).toBe(bids[row.bidder.toLowerCase()]);
    }

    // The winner is computed from the table the page rendered, not hardcoded.
    const best = rows.reduce((a, b) => (Number(a.bid) >= Number(b.bid) ? a : b));
    const v = verdictOf(page, 5);
    await expect(v).toHaveAttribute('data-kind', 'ok');
    expect(await headlineOf(v)).toBe(`Winner: ${best.bidder} with a bid of ${best.bid}.`);
    expect(Math.max(...rows.map((r) => Number(r.bid)))).toBe(Number(best.bid));
    expect(await detailOf(v)).toContain('removes any last-look advantage');
  };

  await runAuction({ alice: '23', bob: '31', carol: '28' });
  // A different field must move the winner — the headline is not a fixed name.
  await runAuction({ alice: '5', bob: '9', carol: '40' });
  await runAuction({ alice: '77', bob: '9', carol: '40' });
});
