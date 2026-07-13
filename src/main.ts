import './style.css';
import {
  brokenCommitNoBlinding,
  bytesToHex,
  commitHash,
  dictionaryAttackBrokenCommit,
  randomBlindingFactor,
  runBindingAttempt,
  runHidingStats,
  verifyHashOpening
} from './hashcommit';
import {
  commitPedersen,
  pointToHex,
  verifyHomomorphicProperty,
  verifyPedersenOpening
} from './pedersen';
import { renderHomomorphismSvg } from './homomorphism-viz';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root');
}

/* A single persistent live region. Because #app's innerHTML is fully
 * replaced on every action, any aria-live node inside it is destroyed and
 * recreated — which screen readers do NOT reliably announce. This element
 * lives outside #app and survives every re-render, so updating its text
 * announces results dependably. */
const announcer = document.createElement('div');
announcer.className = 'sr-only';
announcer.setAttribute('role', 'status');
announcer.setAttribute('aria-live', 'polite');
document.body.appendChild(announcer);

const announce = (message: string): void => {
  // Clearing first guarantees the change is observed even if the text repeats.
  announcer.textContent = '';
  announcer.textContent = message;
};

/* ------------------------------------------------------------------ *
 *  Verdict model — every interactive result is interpreted, not dumped.
 *  A learner should read a plain-English headline and a "why it matters"
 *  detail, with the raw cryptographic values available underneath.
 * ------------------------------------------------------------------ */
type VerdictKind = 'ok' | 'fail' | 'info' | 'pending';

type Verdict = {
  kind: VerdictKind;
  headline: string;
  detail?: string;
  rows?: Array<[label: string, value: string]>;
};

type HashOpenState = {
  message: string;
  blindingHex: string;
  commitmentHex: string;
  opened: boolean;
};

type AuctionEntry = {
  bidder: string;
  bid: number;
  blindingHex: string;
  commitmentHex: string;
};

type State = {
  hashOpen: HashOpenState | null;
  e1Verdict: Verdict;
  e2Verdict: Verdict;
  e2Tries: number;
  e3Hiding: Verdict;
  hidingViz: { zero: number; one: number } | null;
  e3Broken: Verdict;
  brokenCommitHex: string;
  e4Open: Verdict;
  e4Homomorphic: Verdict;
  e4Viz: { m1: number; m2: number } | null;
  hidingContrast: 'normal' | 'infinite' | null;
  auctionCommitted: AuctionEntry[];
  auctionRevealed: boolean;
  auctionVerdict: Verdict;
};

const pending = (headline: string): Verdict => ({ kind: 'pending', headline });

const state: State = {
  hashOpen: null,
  e1Verdict: pending('Commit a value to begin. A fresh blinding factor r is generated for you.'),
  e2Verdict: pending('Run the search to attempt a binding break.'),
  e2Tries: 0,
  e3Hiding: pending('Run the indistinguishability test.'),
  hidingViz: null,
  e3Broken: pending('Build an unblinded commitment, then run the dictionary attack on it.'),
  brokenCommitHex: '',
  e4Open: pending('Commit a value, then open it to verify.'),
  e4Homomorphic: pending('Commit two values and check the homomorphic sum.'),
  e4Viz: null,
  hidingContrast: null,
  auctionCommitted: [],
  auctionRevealed: false,
  auctionVerdict: pending('All bidders commit first; no one can change a bid after seeing the others.')
};

const escapeHtml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? []);

const truncate = (value: string, head = 32): string =>
  value.length > head ? `${value.slice(0, head)}…` : value;

const ICONS: Record<VerdictKind, string> = {
  ok: '✓',
  fail: '✕',
  info: 'ℹ',
  pending: '·'
};

const renderVerdict = (verdict: Verdict): string => {
  const rows = verdict.rows?.length
    ? `<dl class="verdict-rows">${verdict.rows
        .map(
          ([label, value]) =>
            `<div><dt>${escapeHtml(label)}</dt><dd class="mono">${escapeHtml(value)}</dd></div>`
        )
        .join('')}</dl>`
    : '';
  const detail = verdict.detail ? `<p class="verdict-detail">${escapeHtml(verdict.detail)}</p>` : '';
  // No aria-live here: this node is recreated on every render, which screen
  // readers don't reliably announce. The persistent `announcer` does that job.
  return `
    <div class="verdict" data-kind="${verdict.kind}">
      <p class="verdict-head"><span class="verdict-icon" aria-hidden="true">${ICONS[verdict.kind]}</span>${escapeHtml(verdict.headline)}</p>
      ${detail}
      ${rows}
    </div>
  `;
};

const renderBiasViz = (viz: { zero: number; one: number } | null): string => {
  if (!viz) {
    return '';
  }
  const bar = (label: string, fraction: number): string => {
    const pct = (fraction * 100).toFixed(1);
    return `
      <div class="bias-row">
        <span class="bias-label">P(first output byte is odd | m=${escapeHtml(label)})</span>
        <span class="bias-track"><span class="bias-fill" style="width:${pct}%"></span></span>
        <span class="bias-value mono">${pct}%</span>
      </div>`;
  };
  return `
    <figure class="bias-viz" aria-label="Frequency that the first output byte is odd, for commitments to 0 versus 1">
      ${bar('0', viz.zero)}
      ${bar('1', viz.one)}
      <figcaption>This samples one bit (the low bit of C's first byte). Near-equal bars mean that statistic reveals nothing about the committed value; a full commitment leaks nothing across all 256 bits.</figcaption>
    </figure>`;
};

const renderBindingMeter = (tries: number): string => {
  if (tries <= 0) {
    return '';
  }
  // Collision work for a 256-bit hash is ~2^128 by the birthday bound.
  // Fraction covered = tries / 2^128 — so tiny we describe it in words and
  // leading zeros rather than a plottable bar (which would round to 0 width).
  const SPACE_LOG10 = 128 * Math.log10(2); // ≈ 38.53 → search space ~10^38.5
  const triesLog10 = Math.log10(tries);
  const leadingZeros = Math.max(0, Math.floor(SPACE_LOG10 - triesLog10) - 1);
  const zeros = '0'.repeat(Math.min(leadingZeros, 34));
  // Time to exhaust the space at 1e9 hashes/sec, in years.
  const secondsToFinish = Math.pow(2, 128) / 1e9;
  const yearsToFinish = secondsToFinish / (60 * 60 * 24 * 365);
  const yearsExp = Math.floor(Math.log10(yearsToFinish));
  return `
    <div class="binding-meter" role="group" aria-label="Binding search progress against a 2 to the 128 search space">
      <div class="meter-head">
        <span>Fraction of the ~2¹²⁸ collision search covered so far</span>
        <span class="mono meter-frac">0.${zeros}…%</span>
      </div>
      <div class="meter-track" aria-hidden="true">
        <span class="meter-fill" style="width:0.5%"></span>
      </div>
      <p class="meter-note">
        You have tried <strong class="mono">${tries.toLocaleString()}</strong> of roughly
        <strong class="mono">2¹²⁸ ≈ 3.4 × 10³⁸</strong> needed for a birthday collision. Even at a
        billion hashes per second, exhausting that space takes about
        <strong class="mono">10${toSup(yearsExp)}</strong> years — far longer than the age of the
        universe. That gap, not your batch of tries, is what makes SHA-256 binding.
      </p>
    </div>`;
};

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻'
};
const toSup = (n: number): string =>
  String(n).split('').map((c) => SUP[c] ?? c).join('');

const renderHidingContrast = (mode: 'normal' | 'infinite' | null): string => {
  if (mode === null) {
    return '';
  }
  const infinite = mode === 'infinite';
  return `
    <div class="hiding-contrast" aria-labelledby="hiding-contrast-heading">
      <h4 id="hiding-contrast-heading">Two kinds of hidden: computational vs information-theoretic</h4>
      <div class="contrast-grid">
        <div class="contrast-card ${infinite ? 'is-broken' : ''}" data-prim="hash">
          <p class="contrast-title">SHA-256 hash commitment</p>
          <p class="contrast-kind">Computational hiding</p>
          <p class="contrast-body">
            Hidden only because inverting SHA-256 is hard. The value <em>is</em> pinned
            down by <code>C</code> — there is exactly one <code>(m, r)</code> behind a
            typical hash. Secrecy rests on the attacker not having enough compute to find it.
          </p>
          <p class="contrast-status">
            <span class="contrast-badge ${infinite ? 'badge-broken' : 'badge-safe'}" aria-hidden="true">${infinite ? '✕' : '✓'}</span>
            <span>${infinite
              ? 'Against UNLIMITED compute: broken in principle — the attacker inverts the hash and reads m.'
              : 'Against a real (bounded) attacker: safe — inverting SHA-256 is infeasible.'}</span>
          </p>
        </div>
        <div class="contrast-card" data-prim="pedersen">
          <p class="contrast-title">Pedersen commitment</p>
          <p class="contrast-kind">Information-theoretic hiding</p>
          <p class="contrast-body">
            <code>r·G</code> is a uniform, one-time pad over the whole group, so
            <code>C = r·G + m·H</code> is equally likely for <em>every</em> message
            <code>m</code> (each with its own <code>r</code>). <code>C</code> literally
            carries zero information about <code>m</code>.
          </p>
          <p class="contrast-status">
            <span class="contrast-badge badge-safe" aria-hidden="true">✓</span>
            <span>${infinite
              ? 'Against UNLIMITED compute: STILL perfectly hidden — no amount of computation helps.'
              : 'Against a real attacker: perfectly hidden, with margin to spare.'}</span>
          </p>
        </div>
      </div>
      <div class="button-row">
        <button id="e3-attacker-toggle" type="button" aria-pressed="${infinite}">
          ${infinite ? 'Restore a real (bounded) attacker' : 'Unleash an infinite-compute attacker'}
        </button>
      </div>
      <p class="hint">${infinite
        ? 'With unbounded compute the hash commitment falls (its secrecy was only computational), while Pedersen still leaks nothing — that is the practical meaning of information-theoretic hiding.'
        : 'Toggle to simulate an attacker with unlimited computation and see which primitive still hides.'}</p>
    </div>`;
};

const render = (announceText?: string): void => {
  // Preserve keyboard focus across the full innerHTML replacement: capture the
  // focused control's id beforehand and restore it afterward.
  const activeId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  app.innerHTML = `
    <main class="shell" id="main-content">
      <header class="hero">
        <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to light mode"></button>
        <div class="cl-hero">
          <div class="cl-hero-main">
            <h1 class="cl-hero-title">Commitment Schemes</h1>
            <p class="cl-hero-sub">Commit · Open · Verify — hiding + binding</p>
            <p class="cl-hero-desc">Build live SHA-256 hash and Pedersen commitments, publish them, then try to cheat the open to feel where binding and hiding hold or break.</p>
          </div>
          <aside class="cl-hero-why" aria-label="Why it matters">
            <span class="cl-hero-why-label">WHY IT MATTERS</span>
            <p class="cl-hero-why-text">Commitments underpin sealed-bid auctions, coin flips, and zero-knowledge proofs — anywhere you must lock in a value before revealing it. A broken scheme lets a cheater change their answer after seeing yours, or leak the secret early.</p>
          </aside>
        </div>

        <div class="primer">
          <div class="primer-flow" aria-label="Commitment lifecycle">
            <span class="flow-step"><span class="flow-num">1</span> Commit <code>C = f(m, r)</code></span>
            <span class="flow-arrow" aria-hidden="true">→</span>
            <span class="flow-step"><span class="flow-num">2</span> Publish <code>C</code></span>
            <span class="flow-arrow" aria-hidden="true">→</span>
            <span class="flow-step"><span class="flow-num">3</span> Open <code>(m, r)</code></span>
            <span class="flow-arrow" aria-hidden="true">→</span>
            <span class="flow-step"><span class="flow-num">4</span> Verify</span>
          </div>
          <div class="primer-props">
            <p><strong>Binding</strong> — once committed, you cannot open <code>C</code> to a different value than the one you sealed.</p>
            <p><strong>Hiding</strong> — before you open, <code>C</code> leaks nothing about the value inside.</p>
          </div>
          <dl class="legend">
            <div><dt class="mono">m</dt><dd>the message you commit to</dd></div>
            <div><dt class="mono">r</dt><dd>random blinding factor (the secret salt)</dd></div>
            <div><dt class="mono">C</dt><dd>the published commitment</dd></div>
            <div><dt class="mono">G, H</dt><dd>independent curve generators (Pedersen)</dd></div>
          </dl>
        </div>
      </header>

      <section class="exhibit" aria-labelledby="exhibit-1-heading">
        <h2 id="exhibit-1-heading">Exhibit 1 — Commit, Open, and Try to Cheat</h2>
        <p>
          Alice seals a value for Bob with <code>C = SHA-256(r ‖ m)</code>, publishes <code>C</code>, then later
          reveals <code>(m, r)</code>. Bob re-hashes and checks. <strong>Try opening to a different message</strong>
          than you committed — watch Bob reject it. That rejection <em>is</em> the binding property.
        </p>
        <p class="equation">C = SHA-256( r ‖ m )</p>
        <div class="controls-grid">
          <label for="e1-message">Message to commit (m)
            <input id="e1-message" type="text" value="42" />
          </label>
        </div>
        <div class="button-row">
          <button id="e1-commit" type="button">1. Commit &amp; publish</button>
        </div>
        <div class="envelope ${state.hashOpen?.opened ? 'opened' : 'sealed'}">
          <div class="envelope-row"><span class="env-label">Committer</span><span>Alice</span></div>
          <div class="envelope-row"><span class="env-label">Published C</span><span class="mono">${state.hashOpen ? escapeHtml(truncate(state.hashOpen.commitmentHex, 40)) : 'nothing sealed yet'}</span></div>
          <div class="envelope-row"><span class="env-label">Verifier</span><span>Bob</span></div>
        </div>
        ${
          state.hashOpen
            ? `
          <div class="controls-grid open-grid">
            <label for="e1-reveal">Message Alice reveals at open time
              <input id="e1-reveal" type="text" value="${escapeHtml(state.hashOpen.message)}" />
            </label>
          </div>
          <p class="hint">The blinding factor <code>r</code> is fixed at commit time and revealed as-is. Change the message above to attempt a cheat.</p>
          <div class="button-row">
            <button id="e1-open" type="button">2. Open &amp; verify</button>
          </div>`
            : ''
        }
        ${renderVerdict(state.e1Verdict)}
      </section>

      <section class="exhibit" aria-labelledby="exhibit-2-heading">
        <h2 id="exhibit-2-heading">Exhibit 2 — Binding, Quantified</h2>
        <p>
          To break binding you would need a second message that produces the <em>same</em> commitment as the one you
          sealed. Go ahead and <strong>try</strong>: each click hashes a fresh batch of random alternatives. It will
          always fail — but the point is not the failure, it is <em>how little of the search space you have covered</em>.
          The meter below is anchored to the real work a collision requires (≈ 2¹²⁸ hashes), so a few thousand tries is
          not evidence of binding; the size of that number is.
        </p>
        <p class="equation">find m′ ≠ m such that SHA-256(r ‖ m′) = SHA-256(r ‖ m)</p>
        <div class="button-row">
          <button id="e2-binding" type="button">Try to find a colliding m′ (batch of 3,000)</button>
        </div>
        ${renderBindingMeter(state.e2Tries)}
        ${renderVerdict(state.e2Verdict)}
      </section>

      <section class="exhibit" aria-labelledby="exhibit-3-heading">
        <h2 id="exhibit-3-heading">Exhibit 3 — Hiding (and How It Breaks)</h2>
        <p>
          A good commitment reveals nothing before opening. Two commitments to different values should look
          statistically identical. Below: commit to <code>0</code> and <code>1</code> many times and measure
          whether an observer could tell them apart.
        </p>
        <p class="equation">C(0) ≈ᵈ C(1) &nbsp;—&nbsp; indistinguishable to any observer</p>
        <div class="button-row">
          <button id="e3-run" type="button">Run indistinguishability test</button>
        </div>
        ${renderBiasViz(state.hidingViz)}
        ${renderVerdict(state.e3Hiding)}
        ${renderHidingContrast(state.hidingContrast)}

        <hr class="exhibit-divider" />
        <h3>What happens if you drop <code>r</code>?</h3>
        <p>
          Without a blinding factor the commitment is just <code>SHA-256(m)</code> — deterministic. If the set of
          possible messages is small, an attacker simply hashes every candidate and matches. This is why
          <strong>unblinded hash commitments are not hiding</strong>.
        </p>
        <p class="equation equation-danger">C = SHA-256( m ) &nbsp;←&nbsp; no r, no hiding</p>
        <div class="controls-grid">
          <label for="e3-broken-message">Secret value (try a common word)
            <input id="e3-broken-message" type="text" value="yes" />
          </label>
        </div>
        <div class="button-row">
          <button id="e3-broken-commit" type="button">Commit without blinding</button>
          <button id="e3-dictionary" type="button">Run dictionary attack</button>
        </div>
        ${renderVerdict(state.e3Broken)}
      </section>

      <section class="exhibit" aria-labelledby="exhibit-4-heading">
        <h2 id="exhibit-4-heading">Exhibit 4 — Pedersen &amp; the Homomorphic Superpower</h2>
        <p>
          Pedersen commitments live on the P-256 curve: <code>C = r·G + m·H</code> (real point arithmetic, computed
          live). Their magic: you can <strong>add commitments without opening them</strong>, and the sum opens to the
          sum of the values. This underpins private tallies, MPC, and range proofs.
        </p>
        <p class="equation">C(m₁,r₁) + C(m₂,r₂) = C(m₁+m₂, r₁+r₂)</p>
        <div class="callout callout-binding" role="note" aria-label="Why the H generator must have an unknown discrete log">
          <p class="callout-title">Why binding actually holds here</p>
          <p>
            Binding rests on one requirement: <strong>nobody may know the discrete log of <code>H</code> base <code>G</code></strong>.
            If a committer knew a scalar <code>s</code> with <code>H = s·G</code>, then
            <code>C = r·G + m·H = (r + s·m)·G</code>, and they could open the same <code>C</code> to a second
            message <code>m′</code> by picking <code>r′ = r + s·(m − m′)</code> — binding would be broken.
            To avoid that, this demo derives <code>H</code> by <strong>hash-to-curve</strong> (try-and-increment on
            P-256), so <code>log_G(H)</code> is unknown to everyone, including us.
          </p>
        </div>
        <div class="controls-grid">
          <label for="e4-m1">m₁
            <input id="e4-m1" type="number" value="12" min="0" />
          </label>
          <label for="e4-m2">m₂
            <input id="e4-m2" type="number" value="31" min="0" />
          </label>
        </div>
        <div class="button-row">
          <button id="e4-commit-open" type="button">Commit &amp; open m₁</button>
          <button id="e4-homomorphic" type="button">Add commitments &amp; verify</button>
        </div>
        ${renderVerdict(state.e4Open)}
        ${renderVerdict(state.e4Homomorphic)}
        ${state.e4Viz ? renderHomomorphismSvg({ m: state.e4Viz.m1, r: 1 }, { m: state.e4Viz.m2, r: 2 }) : ''}
      </section>

      <section class="exhibit" aria-labelledby="exhibit-5-heading">
        <h2 id="exhibit-5-heading">Exhibit 5 — Sealed-Bid Auction</h2>
        <p>
          Commitments make fair auctions possible. Every bidder publishes a commitment <em>first</em>; only then does
          everyone reveal. Because of binding, no one can lower or raise their bid after seeing the others.
        </p>
        <div class="controls-grid">
          <label for="e5-bid-alice">Alice bid
            <input id="e5-bid-alice" type="number" value="23" min="0" />
          </label>
          <label for="e5-bid-bob">Bob bid
            <input id="e5-bid-bob" type="number" value="31" min="0" />
          </label>
          <label for="e5-bid-carol">Carol bid
            <input id="e5-bid-carol" type="number" value="28" min="0" />
          </label>
        </div>
        <div class="button-row">
          <button id="e5-commit" type="button">1. Publish commitments</button>
          <button id="e5-reveal" type="button">2. Reveal &amp; verify</button>
        </div>
        <div class="table-wrap" role="region" aria-label="Auction results" tabindex="0">
          <table>
            <caption class="sr-only">Sealed bid auction commitments and results</caption>
            <thead><tr><th scope="col">Bidder</th><th scope="col">Commitment</th><th scope="col">Bid</th></tr></thead>
            <tbody>
              ${
                state.auctionCommitted.length
                  ? state.auctionCommitted
                      .map(
                        (entry) =>
                          `<tr><td>${escapeHtml(entry.bidder)}</td><td class="mono">${escapeHtml(truncate(entry.commitmentHex, 24))}</td><td>${
                            state.auctionRevealed ? entry.bid : '🔒 sealed'
                          }</td></tr>`
                      )
                      .join('')
                  : '<tr><td colspan="3">No commitments published yet.</td></tr>'
              }
            </tbody>
          </table>
        </div>
        ${renderVerdict(state.auctionVerdict)}
      </section>

      <section class="exhibit" aria-labelledby="exhibit-6-heading">
        <h2 id="exhibit-6-heading">Exhibit 6 — Where Commitments Appear</h2>
        <p>The same two primitives you just used show up across the crypto-lab portfolio.</p>
        <nav class="map-grid" aria-label="Related crypto labs">
          <a class="map-card" href="https://systemslibrarian.github.io/crypto-lab-vss-gate/" target="_blank" rel="noreferrer">
            <h3>VSS Gate</h3><p>Feldman/Pedersen commitments for share verification.</p>
          </a>
          <a class="map-card" href="https://systemslibrarian.github.io/crypto-lab-frost-threshold/" target="_blank" rel="noreferrer">
            <h3>FROST Threshold</h3><p>Nonce commitments in threshold signing rounds.</p>
          </a>
          <a class="map-card" href="https://systemslibrarian.github.io/crypto-lab-zk-proof-lab/" target="_blank" rel="noreferrer">
            <h3>ZK Proof Lab</h3><p>Fiat-Shamir uses commitment-style transcript binding.</p>
          </a>
          <a class="map-card" href="https://systemslibrarian.github.io/crypto-lab-garbled-gate/" target="_blank" rel="noreferrer">
            <h3>Garbled Gate</h3><p>Oblivious transfer commitments for input consistency.</p>
          </a>
          <a class="map-card" href="https://systemslibrarian.github.io/crypto-lab-snark-arena/" target="_blank" rel="noreferrer">
            <h3>SNARK Arena</h3><p>Polynomial commitments in succinct proofs.</p>
          </a>
        </nav>
      </section>
    </main>
  `;

  initThemeToggle();
  bindEvents();

  if (activeId) {
    document.getElementById(activeId)?.focus();
  }
  if (announceText) {
    announce(announceText);
  }
};

const initThemeToggle = (): void => {
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) {
    return;
  }

  const applyState = (): void => {
    const isDark = (root.getAttribute('data-theme') ?? 'dark') === 'dark';
    button.textContent = isDark ? '🌙' : '☀️';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  };

  button.addEventListener('click', () => {
    const current = (root.getAttribute('data-theme') ?? 'dark') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    applyState();
  });

  applyState();
};

const bindEvents = (): void => {
  /* --- Exhibit 1: commit / open / cheat --- */
  document.querySelector<HTMLButtonElement>('#e1-commit')?.addEventListener('click', async () => {
    const message = document.querySelector<HTMLInputElement>('#e1-message')?.value ?? '';
    const r = randomBlindingFactor();
    const commitment = await commitHash(message, r);
    state.hashOpen = {
      message,
      blindingHex: bytesToHex(r),
      commitmentHex: bytesToHex(commitment),
      opened: false
    };
    state.e1Verdict = {
      kind: 'info',
      headline: 'Sealed. Commitment published to Bob.',
      detail: 'Bob now holds C but learns nothing about m. Open honestly to verify — or change the revealed message to try to cheat.',
      rows: [
        ['Committed m', message],
        ['Blinding r', truncate(state.hashOpen.blindingHex, 40)],
        ['Published C', truncate(state.hashOpen.commitmentHex, 40)]
      ]
    };
    render(state.e1Verdict.headline);
  });

  document.querySelector<HTMLButtonElement>('#e1-open')?.addEventListener('click', async () => {
    if (!state.hashOpen) {
      return;
    }
    const revealed = document.querySelector<HTMLInputElement>('#e1-reveal')?.value ?? '';
    const r = hexToBytes(state.hashOpen.blindingHex);
    const verified = await verifyHashOpening(revealed, r, hexToBytes(state.hashOpen.commitmentHex));
    const tampered = revealed !== state.hashOpen.message;

    state.hashOpen = { ...state.hashOpen, opened: true };
    state.e1Verdict = verified
      ? {
          kind: 'ok',
          headline: 'Bob accepts the opening.',
          detail: 'SHA-256(r ‖ revealed message) equals the published C. The revealed value is provably the one Alice sealed.',
          rows: [
            ['Revealed m', revealed],
            ['Recomputed C', truncate(state.hashOpen.commitmentHex, 40)]
          ]
        }
      : {
          kind: 'fail',
          headline: tampered ? 'Bob rejects — cheating detected.' : 'Bob rejects the opening.',
          detail: tampered
            ? `You committed "${state.hashOpen.message}" but tried to open "${revealed}". A different message hashes to a different C, so verification fails. This is binding in action: Alice is locked to her original value.`
            : 'The recomputed commitment does not match C.',
          rows: [
            ['Committed m', state.hashOpen.message],
            ['Tried to reveal', revealed]
          ]
        };
    render(state.e1Verdict.headline);
  });

  /* --- Exhibit 2: binding --- */
  document.querySelector<HTMLButtonElement>('#e2-binding')?.addEventListener('click', async () => {
    state.e2Verdict = { kind: 'pending', headline: 'Searching for a collision…' };
    render(state.e2Verdict.headline);
    const run = await runBindingAttempt('commit-me', 3000);
    state.e2Tries += run.tries;
    state.e2Verdict = {
      kind: run.foundCollision ? 'fail' : 'info',
      headline: run.foundCollision
        ? 'Collision found — binding broken!'
        : `Still no colliding m′ (${state.e2Tries.toLocaleString()} tried so far).`,
      detail: run.foundCollision
        ? 'A second message produced the same commitment.'
        : 'This failure is NOT the proof — you have barely dented the search space (see the meter above). Binding is guaranteed because finding any m′ needs ≈ 2¹²⁸ hashes, not because a few thousand tries missed. Click again to watch the fraction covered stay effectively zero.',
      rows: [
        ['Fixed commitment', truncate(run.originalCommitmentHex, 40)],
        ['Total messages tried', state.e2Tries.toLocaleString()],
        ['Collisions found', String(run.foundCollision ? 1 : 0)]
      ]
    };
    render(state.e2Verdict.headline);
  });

  /* --- Exhibit 3: hiding + broken construction --- */
  document.querySelector<HTMLButtonElement>('#e3-run')?.addEventListener('click', async () => {
    state.e3Hiding = { kind: 'pending', headline: 'Sampling commitments…' };
    render(state.e3Hiding.headline);
    const c0 = await commitHash('0', randomBlindingFactor());
    const c1 = await commitHash('1', randomBlindingFactor());
    const stats = await runHidingStats(512);
    state.hidingViz = { zero: stats.bit1BiasZero, one: stats.bit1BiasOne };
    if (state.hidingContrast === null) {
      state.hidingContrast = 'normal';
    }
    const indistinguishable = stats.absBiasDelta < 0.1;
    state.e3Hiding = {
      kind: indistinguishable ? 'ok' : 'info',
      headline: indistinguishable
        ? 'Indistinguishable — an observer cannot tell 0 from 1.'
        : 'Sampling noise this run; rerun for a tighter result.',
      detail: `Across ${stats.samples} fresh commitments each, the chance the last bit is 1 was ${(stats.bit1BiasZero * 100).toFixed(1)}% for m=0 and ${(stats.bit1BiasOne * 100).toFixed(1)}% for m=1. The gap of ${(stats.absBiasDelta * 100).toFixed(1)}% is statistical noise — the blinding factor r scrambles C so the value inside leaks nothing.`,
      rows: [
        ['A sample C(0)', truncate(bytesToHex(c0), 40)],
        ['A sample C(1)', truncate(bytesToHex(c1), 40)],
        ['Bias gap |Δ|', stats.absBiasDelta.toFixed(4)]
      ]
    };
    render(state.e3Hiding.headline);
  });

  document.querySelector<HTMLButtonElement>('#e3-attacker-toggle')?.addEventListener('click', () => {
    state.hidingContrast = state.hidingContrast === 'infinite' ? 'normal' : 'infinite';
    render(
      state.hidingContrast === 'infinite'
        ? 'Infinite-compute attacker: the hash commitment is broken in principle; Pedersen still hides perfectly.'
        : 'Bounded attacker restored: both commitments hide.'
    );
  });

  document.querySelector<HTMLButtonElement>('#e3-broken-commit')?.addEventListener('click', async () => {
    const msg = document.querySelector<HTMLInputElement>('#e3-broken-message')?.value ?? 'yes';
    const c = await brokenCommitNoBlinding(msg);
    state.brokenCommitHex = bytesToHex(c);
    state.e3Broken = {
      kind: 'info',
      headline: 'Unblinded commitment built — now attack it.',
      detail: 'This is just SHA-256(message) with no secret salt. Run the dictionary attack to see how fast it falls.',
      rows: [['C = SHA-256(m)', truncate(state.brokenCommitHex, 40)]]
    };
    render(state.e3Broken.headline);
  });

  document.querySelector<HTMLButtonElement>('#e3-dictionary')?.addEventListener('click', async () => {
    if (!state.brokenCommitHex) {
      state.e3Broken = { kind: 'info', headline: 'Build the unblinded commitment first.' };
      render(state.e3Broken.headline);
      return;
    }
    const dict = ['no', 'yes', '0', '1', 'true', 'false', 'alice', 'bob', 'carol', '42'];
    const recovered = await dictionaryAttackBrokenCommit(state.brokenCommitHex, dict);
    state.e3Broken = recovered.recoveredMessage
      ? {
          kind: 'fail',
          headline: `Secret recovered: "${recovered.recoveredMessage}".`,
          detail: `The attacker hashed candidates one by one and matched yours after ${recovered.attempts} guess${recovered.attempts === 1 ? '' : 'es'}. With no blinding factor, a small message space offers no hiding at all. A random r would have made this attack hopeless.`,
          rows: [
            ['Dictionary size', String(dict.length)],
            ['Guesses to break', String(recovered.attempts)]
          ]
        }
      : {
          kind: 'info',
          headline: 'Not in this dictionary — but still not hiding.',
          detail: `Your value was not among the ${dict.length} common candidates, but the commitment is still deterministic: any attacker who guesses the right message space recovers it. Try a value like "yes" or "42".`
        };
    render(state.e3Broken.headline);
  });

  /* --- Exhibit 4: Pedersen --- */
  document.querySelector<HTMLButtonElement>('#e4-commit-open')?.addEventListener('click', async () => {
    const m = BigInt(document.querySelector<HTMLInputElement>('#e4-m1')?.value ?? '0');
    const commit = await commitPedersen(m);
    const ok = await verifyPedersenOpening(commit);
    state.e4Open = {
      kind: ok ? 'ok' : 'fail',
      headline: ok ? `Opened m₁ = ${m} and the point checks out.` : 'Opening failed.',
      detail: ok
        ? 'Bob recomputes r·G + m·H from the revealed scalars and gets exactly the published point. Binding holds because log_G(H) is unknown (H is hash-to-curve, not a multiple of G) — so no second opening exists.'
        : 'The recomputed curve point did not match.',
      rows: [
        ['Commitment C', truncate(pointToHex(commit.commitment), 56)],
        ['Message scalar m', commit.messageScalar.toString()]
      ]
    };
    render(state.e4Open.headline);
  });

  document.querySelector<HTMLButtonElement>('#e4-homomorphic')?.addEventListener('click', async () => {
    const m1 = BigInt(document.querySelector<HTMLInputElement>('#e4-m1')?.value ?? '0');
    const m2 = BigInt(document.querySelector<HTMLInputElement>('#e4-m2')?.value ?? '0');
    const c1 = await commitPedersen(m1);
    const c2 = await commitPedersen(m2);
    const homo = await verifyHomomorphicProperty(c1, c2);
    state.e4Viz = homo.ok ? { m1: Number(m1), m2: Number(m2) } : null;
    state.e4Homomorphic = {
      kind: homo.ok ? 'ok' : 'fail',
      headline: homo.ok
        ? `Adding the two commitments opens to ${m1} + ${m2} = ${(m1 + m2).toString()}.`
        : 'Homomorphic check failed.',
      detail: homo.ok
        ? 'The sum of the two commitment points equals a fresh commitment to the summed value and summed blinding — proven on the live curve. No value was ever opened to compute the total.'
        : 'The point sum did not match a commitment to the summed values.',
      rows: [
        ['Sum of messages', homo.sumMessage.toString()],
        ['C₁ + C₂ point', truncate(pointToHex(homo.left), 56)],
        ['C(m₁+m₂) point', truncate(pointToHex(homo.right), 56)]
      ]
    };
    render(state.e4Homomorphic.headline);
  });

  /* --- Exhibit 5: auction --- */
  document.querySelector<HTMLButtonElement>('#e5-commit')?.addEventListener('click', async () => {
    const bids = [
      ['Alice', Number.parseInt(document.querySelector<HTMLInputElement>('#e5-bid-alice')?.value ?? '0', 10)],
      ['Bob', Number.parseInt(document.querySelector<HTMLInputElement>('#e5-bid-bob')?.value ?? '0', 10)],
      ['Carol', Number.parseInt(document.querySelector<HTMLInputElement>('#e5-bid-carol')?.value ?? '0', 10)]
    ] as const;

    const committed: AuctionEntry[] = [];
    for (const [bidder, bid] of bids) {
      const r = randomBlindingFactor();
      const commitment = await commitHash(String(bid), r);
      committed.push({ bidder, bid, blindingHex: bytesToHex(r), commitmentHex: bytesToHex(commitment) });
    }
    state.auctionCommitted = committed;
    state.auctionRevealed = false;
    state.auctionVerdict = {
      kind: 'info',
      headline: 'All three bids are sealed and published simultaneously.',
      detail: 'Each bid is hidden behind its own commitment. No bidder can see another\'s number, and none can change their own. Reveal to verify and find the winner.'
    };
    render(state.auctionVerdict.headline);
  });

  document.querySelector<HTMLButtonElement>('#e5-reveal')?.addEventListener('click', async () => {
    if (!state.auctionCommitted.length) {
      state.auctionVerdict = { kind: 'info', headline: 'Publish commitments first.' };
      render(state.auctionVerdict.headline);
      return;
    }
    for (const entry of state.auctionCommitted) {
      const ok = await verifyHashOpening(
        String(entry.bid),
        hexToBytes(entry.blindingHex),
        hexToBytes(entry.commitmentHex)
      );
      if (!ok) {
        state.auctionRevealed = false;
        state.auctionVerdict = {
          kind: 'fail',
          headline: 'An opening did not verify.',
          detail: `${entry.bidder}'s revealed bid does not match their commitment.`
        };
        render(state.auctionVerdict.headline);
        return;
      }
    }
    state.auctionRevealed = true;
    const winner = state.auctionCommitted.reduce((a, b) => (a.bid >= b.bid ? a : b));
    state.auctionVerdict = {
      kind: 'ok',
      headline: `Winner: ${winner.bidder} with a bid of ${winner.bid}.`,
      detail: 'Every opening matched its commitment, so all bids are provably the ones sealed before the reveal. Commit-then-reveal removes any last-look advantage.'
    };
    render(state.auctionVerdict.headline);
  });
};

render();
