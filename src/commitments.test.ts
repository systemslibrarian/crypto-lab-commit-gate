import { describe, expect, it } from 'vitest';
import {
  brokenCommitNoBlinding,
  bytesToHex,
  commitHash,
  dictionaryAttackBrokenCommit,
  hexToBytes,
  randomBlindingFactor,
  runBindingAttempt,
  runHidingStats,
  verifyHashOpening
} from './hashcommit';
import {
  addCommitments,
  commitPedersen,
  getGenerators,
  isOnCurve,
  randomScalar,
  verifyHomomorphicProperty,
  verifyPedersenOpening
} from './pedersen';
import { coinOutcome, selectiveAbortCases } from './coinflip';

describe('hash commitments', () => {
  it('is deterministic for a fixed message and blinding factor', async () => {
    const r = randomBlindingFactor();
    const a = await commitHash('hello', r);
    const b = await commitHash('hello', r);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('changes the commitment when the blinding factor changes (hiding)', async () => {
    const a = await commitHash('hello', randomBlindingFactor());
    const b = await commitHash('hello', randomBlindingFactor());
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('verifies an honest opening', async () => {
    const r = randomBlindingFactor();
    const c = await commitHash('42', r);
    expect(await verifyHashOpening('42', r, c)).toBe(true);
  });

  it('rejects a tampered opening (binding)', async () => {
    const r = randomBlindingFactor();
    const c = await commitHash('42', r);
    expect(await verifyHashOpening('43', r, c)).toBe(false);
  });

  it('finds no collision in a bounded binding search', async () => {
    const run = await runBindingAttempt('commit-me', 200);
    expect(run.foundCollision).toBe(false);
    expect(run.tries).toBe(200);
  });

  it('samples one approximately balanced output bit for C(0) and C(1)', async () => {
    const stats = await runHidingStats(256);
    expect(stats.absBiasDelta).toBeLessThan(0.2);
  });

  it('round-trips hex encoding', () => {
    const r = randomBlindingFactor();
    expect(bytesToHex(hexToBytes(bytesToHex(r)))).toBe(bytesToHex(r));
  });
});

describe('broken unblinded commitments', () => {
  it('is deterministic (no hiding) and falls to a dictionary attack', async () => {
    const c = await brokenCommitNoBlinding('yes');
    const again = await brokenCommitNoBlinding('yes');
    expect(bytesToHex(c)).toBe(bytesToHex(again));

    const result = await dictionaryAttackBrokenCommit(bytesToHex(c), ['no', 'maybe', 'yes']);
    expect(result.recoveredMessage).toBe('yes');
    expect(result.attempts).toBe(3);
  });

  it('reports no recovery when the message is outside the dictionary', async () => {
    const c = await brokenCommitNoBlinding('an-unguessed-secret');
    const result = await dictionaryAttackBrokenCommit(bytesToHex(c), ['yes', 'no']);
    expect(result.recoveredMessage).toBeNull();
  });
});

describe('pedersen commitments on P-256', () => {
  it('verifies an honest opening', async () => {
    const commit = await commitPedersen(12n);
    expect(await verifyPedersenOpening(commit)).toBe(true);
  });

  it('rejects an opening with a swapped message scalar (binding)', async () => {
    const commit = await commitPedersen(12n);
    const forged = { ...commit, messageScalar: 13n };
    expect(await verifyPedersenOpening(forged)).toBe(false);
  });

  it('is additively homomorphic: C(m1)+C(m2) opens to m1+m2', async () => {
    const c1 = await commitPedersen(12n);
    const c2 = await commitPedersen(31n);
    const homo = await verifyHomomorphicProperty(c1, c2);
    expect(homo.ok).toBe(true);
    expect(homo.sumMessage).toBe(43n);
  });

  it('derives H as a real on-curve point distinct from G (hash-to-curve)', async () => {
    const { G, H } = await getGenerators();
    expect(isOnCurve(G)).toBe(true);
    expect(isOnCurve(H)).toBe(true);
    // H must not equal G, or the "independent generators" claim collapses.
    expect(H.x === G.x && H.y === G.y).toBe(false);
  });

  it('matches a direct point sum of the two commitments', async () => {
    const c1 = await commitPedersen(5n);
    const c2 = await commitPedersen(7n);
    const summed = addCommitments(c1.commitment, c2.commitment);
    const homo = await verifyHomomorphicProperty(c1, c2);
    expect(homo.left).toEqual(summed);
  });

  it('preserves an explicit zero blinder and accepts the group identity as a valid point', async () => {
    const identity = await commitPedersen(0n, 0n);
    expect(identity.blindingScalar).toBe(0n);
    expect(identity.commitment).toEqual({ inf: true });
    expect(await verifyPedersenOpening(identity)).toBe(true);
    const changed = { ...identity, messageScalar: 1n };
    expect(await verifyPedersenOpening(changed)).toBe(false);

    const a = await commitPedersen(12n, 8n);
    const b = await commitPedersen(-12n, -8n);
    const sum = await verifyHomomorphicProperty(a, b);
    expect(sum.ok).toBe(true);
    expect(sum.left).toEqual({ inf: true });
    expect(sum.right).toEqual({ inf: true });
  });

  it('samples scalars by rejecting out-of-range bytes, including without rejecting zero', () => {
    const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    const asBytes = (value: bigint) => Uint8Array.from(
      (value.toString(16).padStart(64, '0').match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))
    );
    let calls = 0;
    const selected = randomScalar(() => {
      calls += 1;
      return calls === 1 ? asBytes(order) : asBytes(0n);
    });
    expect(calls).toBe(2);
    expect(selected).toBe(0n);
    expect(randomScalar(() => asBytes(order - 1n))).toBe(order - 1n);
  });
});

describe('commit-based coin flip', () => {
  it('makes exactly half the equally likely bit pairs abort under a selective-reveal strategy', () => {
    const cases = selectiveAbortCases();
    expect(cases).toHaveLength(4);
    expect(cases.map((row) => row.honestOutcome)).toEqual([0, 1, 1, 0]);
    expect(cases.map((row) => row.selectiveOutcome)).toEqual([0, null, null, 0]);
    for (const row of cases) {
      expect(row.honestOutcome).toBe(coinOutcome(row.bob, row.alice));
    }
  });

  it('verifies an honest bit but rejects changing that bit after Alice chooses', async () => {
    const r = randomBlindingFactor();
    const published = await commitHash('0', r);
    expect(await verifyHashOpening('0', r, published)).toBe(true);
    expect(await verifyHashOpening('1', r, published)).toBe(false);
  });
});
