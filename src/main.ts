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

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root');
}

type HashOpenState = {
  message: string;
  blindingHex: string;
  commitmentHex: string;
  opened: boolean;
  verified: boolean;
};

type AuctionEntry = {
  bidder: string;
  bid: number;
  blindingHex: string;
  commitmentHex: string;
};

type State = {
  hashOpen: HashOpenState | null;
  bindingText: string;
  brokenCommitHex: string;
  dictionaryResult: string;
  hidingResult: string;
  hidingCommit0: string;
  hidingCommit1: string;
  pedersenResult: string;
  pedersenHomomorphicResult: string;
  auctionCommitted: AuctionEntry[];
  auctionRevealed: boolean;
};

const state: State = {
  hashOpen: null,
  bindingText: 'Run the binding test to attempt a second opening for the same commitment.',
  brokenCommitHex: '',
  dictionaryResult: 'Generate a broken commitment, then run dictionary attack.',
  hidingResult: 'Run statistical check to compare commitments to 0 and 1.',
  hidingCommit0: '',
  hidingCommit1: '',
  pedersenResult: 'Create Pedersen commitments to open and verify.',
  pedersenHomomorphicResult: 'Commit two values and verify homomorphic sum opening.',
  auctionCommitted: [],
  auctionRevealed: false
};

const escapeHtml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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

const render = (): void => {
  app.innerHTML = `
    <main class="shell" id="main-content">
      <header class="hero">
        <button id="theme-toggle" class="theme-toggle" type="button" style="position: absolute; top: 0.5rem; right: 0.5rem" aria-label="Switch to light mode"></button>
        <p class="eyebrow">systemslibrarian · crypto-lab</p>
        <h1>crypto-lab-commit-gate</h1>
        <p>
          Interactive commitment scheme lab covering hash commitments, Pedersen commitments, binding and hiding,
          and protocol patterns in auctions, ZK proofs, MPC, and VSS.
        </p>
      </header>

      <section class="exhibit" aria-labelledby="exhibit-1-heading">
        <h2 id="exhibit-1-heading">Exhibit 1 — Commit and Open</h2>
        <p>Committer Alice seals a value for Verifier Bob, then later opens with message + blinding factor.</p>
        <div class="controls-grid">
          <label for="e1-message">Message</label>
          <input id="e1-message" type="text" value="42" />
        </div>
        <div class="button-row">
          <button id="e1-commit" type="button">Commit</button>
          <button id="e1-open" type="button">Open</button>
        </div>
        <div class="envelope ${state.hashOpen?.opened ? 'opened' : 'sealed'}" role="status">
          <div><strong>Committer:</strong> Alice</div>
          <div><strong>Commitment:</strong> <span class="mono">${state.hashOpen ? escapeHtml(state.hashOpen.commitmentHex) : 'none yet'}</span></div>
          <div><strong>Verifier:</strong> Bob</div>
        </div>
        <p class="mono" aria-live="polite">
          ${
            state.hashOpen
              ? `r=${escapeHtml(state.hashOpen.blindingHex)} | verify=${state.hashOpen.verified ? 'pass' : 'pending/fail'}`
              : 'Create commitment to begin.'
          }
        </p>
      </section>

      <section class="exhibit" aria-labelledby="exhibit-2-heading">
        <h2 id="exhibit-2-heading">Exhibit 2 — Binding Property</h2>
        <p>Try to open one commitment to two different messages, then compare with broken no-blinding commitments.</p>
        <div class="button-row">
          <button id="e2-binding" type="button">Attempt collision search</button>
        </div>
        <p class="mono" aria-live="polite">${escapeHtml(state.bindingText)}</p>
        <div class="controls-grid">
          <label for="e2-broken-message">Broken commitment message</label>
          <input id="e2-broken-message" type="text" value="yes" />
        </div>
        <div class="button-row">
          <button id="e2-broken-commit" type="button">Commit without blinding</button>
          <button id="e2-dictionary" type="button">Run dictionary attack</button>
        </div>
        <p class="mono" aria-live="polite">Broken commitment: ${escapeHtml(state.brokenCommitHex || 'none')}</p>
        <p class="mono" aria-live="polite">${escapeHtml(state.dictionaryResult)}</p>
      </section>

      <section class="exhibit" aria-labelledby="exhibit-3-heading">
        <h2 id="exhibit-3-heading">Exhibit 3 — Hiding Property</h2>
        <p>
          Hash commitments are computationally hiding, while Pedersen commitments are perfectly hiding (information-theoretic)
          under standard assumptions.
        </p>
        <div class="button-row">
          <button id="e3-run" type="button">Run indistinguishability stats</button>
        </div>
        <p class="mono" aria-live="polite">C(0): ${escapeHtml(state.hidingCommit0 || 'not generated')}</p>
        <p class="mono" aria-live="polite">C(1): ${escapeHtml(state.hidingCommit1 || 'not generated')}</p>
        <p class="mono" aria-live="polite">${escapeHtml(state.hidingResult)}</p>
      </section>

      <section class="exhibit" aria-labelledby="exhibit-4-heading">
        <h2 id="exhibit-4-heading">Exhibit 4 — Homomorphic Pedersen</h2>
        <p>
          Verify C(m1,r1)+C(m2,r2)=C(m1+m2,r1+r2) on P-256 with real point arithmetic. This underpins MPC tallies,
          range proofs, and many ZKP constructions.
        </p>
        <div class="controls-grid">
          <label for="e4-m1">m1</label>
          <input id="e4-m1" type="number" value="12" min="0" />
          <label for="e4-m2">m2</label>
          <input id="e4-m2" type="number" value="31" min="0" />
        </div>
        <div class="button-row">
          <button id="e4-commit-open" type="button">Commit and open one value</button>
          <button id="e4-homomorphic" type="button">Verify homomorphic addition</button>
        </div>
        <p class="mono" aria-live="polite">${escapeHtml(state.pedersenResult)}</p>
        <p class="mono" aria-live="polite">${escapeHtml(state.pedersenHomomorphicResult)}</p>
      </section>

      <section class="exhibit" aria-labelledby="exhibit-5-heading">
        <h2 id="exhibit-5-heading">Exhibit 5 — Sealed Bid Auction</h2>
        <p>All bidders commit first, then reveal. No one can change bids after seeing others.</p>
        <div class="controls-grid">
          <label for="e5-bid-alice">Alice bid</label>
          <input id="e5-bid-alice" type="number" value="23" min="0" />
          <label for="e5-bid-bob">Bob bid</label>
          <input id="e5-bid-bob" type="number" value="31" min="0" />
          <label for="e5-bid-carol">Carol bid</label>
          <input id="e5-bid-carol" type="number" value="28" min="0" />
        </div>
        <div class="button-row">
          <button id="e5-commit" type="button">Publish commitments</button>
          <button id="e5-reveal" type="button">Reveal bids</button>
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
                          `<tr><td>${escapeHtml(entry.bidder)}</td><td class="mono">${escapeHtml(entry.commitmentHex)}</td><td>${
                            state.auctionRevealed ? entry.bid : 'sealed'
                          }</td></tr>`
                      )
                      .join('')
                  : '<tr><td colspan="3">No commitments published yet.</td></tr>'
              }
            </tbody>
          </table>
        </div>
        <p class="mono" aria-live="polite">
          ${
            state.auctionRevealed && state.auctionCommitted.length
              ? `Winner: ${state.auctionCommitted.reduce((a, b) => (a.bid >= b.bid ? a : b)).bidder}`
              : 'Commitments published simultaneously before reveal phase.'
          }
        </p>
      </section>

      <section class="exhibit" aria-labelledby="exhibit-6-heading">
        <h2 id="exhibit-6-heading">Exhibit 6 — Where Commitments Appear</h2>
        <p>Commitment schemes appear across the crypto-lab portfolio.</p>
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
};

const bindEvents = (): void => {
  const e1Commit = document.querySelector<HTMLButtonElement>('#e1-commit');
  const e1Open = document.querySelector<HTMLButtonElement>('#e1-open');
  const e1Message = document.querySelector<HTMLInputElement>('#e1-message');

  e1Commit?.addEventListener('click', async () => {
    const message = e1Message?.value ?? '';
    const r = randomBlindingFactor();
    const commitment = await commitHash(message, r);
    state.hashOpen = {
      message,
      blindingHex: bytesToHex(r),
      commitmentHex: bytesToHex(commitment),
      opened: false,
      verified: false
    };
    render();
  });

  e1Open?.addEventListener('click', async () => {
    if (!state.hashOpen) {
      return;
    }
    const verified = await verifyHashOpening(
      state.hashOpen.message,
      new Uint8Array(state.hashOpen.blindingHex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? []),
      new Uint8Array(state.hashOpen.commitmentHex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? [])
    );
    state.hashOpen = { ...state.hashOpen, opened: true, verified };
    render();
  });

  const e2Binding = document.querySelector<HTMLButtonElement>('#e2-binding');
  e2Binding?.addEventListener('click', async () => {
    const run = await runBindingAttempt('commit-me', 3000);
    state.bindingText = `trials=${run.tries}, collisionFound=${run.foundCollision}, commitment=${run.originalCommitmentHex.slice(0, 24)}...`;
    render();
  });

  const e2BrokenCommit = document.querySelector<HTMLButtonElement>('#e2-broken-commit');
  e2BrokenCommit?.addEventListener('click', async () => {
    const msg = document.querySelector<HTMLInputElement>('#e2-broken-message')?.value ?? 'yes';
    const c = await brokenCommitNoBlinding(msg);
    state.brokenCommitHex = bytesToHex(c);
    state.dictionaryResult = 'Broken commitment generated. Attack ready.';
    render();
  });

  const e2Dictionary = document.querySelector<HTMLButtonElement>('#e2-dictionary');
  e2Dictionary?.addEventListener('click', async () => {
    if (!state.brokenCommitHex) {
      return;
    }
    const dict = ['no', 'yes', '0', '1', 'alice', 'bob', 'carol', '42'];
    const recovered = await dictionaryAttackBrokenCommit(state.brokenCommitHex, dict);
    state.dictionaryResult = recovered.recoveredMessage
      ? `Recovered '${recovered.recoveredMessage}' in ${recovered.attempts} guesses.`
      : `Not found in ${recovered.attempts} guesses.`;
    render();
  });

  const e3Run = document.querySelector<HTMLButtonElement>('#e3-run');
  e3Run?.addEventListener('click', async () => {
    const c0 = await commitHash('0', randomBlindingFactor());
    const c1 = await commitHash('1', randomBlindingFactor());
    const stats = await runHidingStats(512);
    state.hidingCommit0 = bytesToHex(c0);
    state.hidingCommit1 = bytesToHex(c1);
    state.hidingResult = `samples=${stats.samples}, P(lsb=1|m=0)=${stats.bit1BiasZero.toFixed(3)}, P(lsb=1|m=1)=${stats.bit1BiasOne.toFixed(3)}, |delta|=${stats.absBiasDelta.toFixed(3)}`;
    render();
  });

  const e4Open = document.querySelector<HTMLButtonElement>('#e4-commit-open');
  e4Open?.addEventListener('click', async () => {
    const m = BigInt(document.querySelector<HTMLInputElement>('#e4-m1')?.value ?? '0');
    const commit = await commitPedersen(m);
    const ok = await verifyPedersenOpening(commit);
    state.pedersenResult = `C=${pointToHex(commit.commitment).slice(0, 70)}... verify=${ok}`;
    render();
  });

  const e4Homomorphic = document.querySelector<HTMLButtonElement>('#e4-homomorphic');
  e4Homomorphic?.addEventListener('click', async () => {
    const m1 = BigInt(document.querySelector<HTMLInputElement>('#e4-m1')?.value ?? '0');
    const m2 = BigInt(document.querySelector<HTMLInputElement>('#e4-m2')?.value ?? '0');
    const c1 = await commitPedersen(m1);
    const c2 = await commitPedersen(m2);
    const homo = await verifyHomomorphicProperty(c1, c2);
    state.pedersenHomomorphicResult = `sumMessage=${homo.sumMessage.toString()} sumBlinding=${homo.sumBlinding.toString()} verified=${homo.ok}`;
    render();
  });

  const e5Commit = document.querySelector<HTMLButtonElement>('#e5-commit');
  e5Commit?.addEventListener('click', async () => {
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
    render();
  });

  const e5Reveal = document.querySelector<HTMLButtonElement>('#e5-reveal');
  e5Reveal?.addEventListener('click', async () => {
    if (!state.auctionCommitted.length) {
      return;
    }
    for (const entry of state.auctionCommitted) {
      const ok = await verifyHashOpening(
        String(entry.bid),
        new Uint8Array(entry.blindingHex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? []),
        new Uint8Array(entry.commitmentHex.match(/.{1,2}/g)?.map((x) => Number.parseInt(x, 16)) ?? [])
      );
      if (!ok) {
        state.auctionRevealed = false;
        render();
        return;
      }
    }
    state.auctionRevealed = true;
    render();
  });
};

render();
