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
  verifyHomomorphicProperty,
  verifyPedersenOpening
} from './pedersen';

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

  it('produces a near-zero indistinguishability gap between C(0) and C(1)', async () => {
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

  it('matches a direct point sum of the two commitments', async () => {
    const c1 = await commitPedersen(5n);
    const c2 = await commitPedersen(7n);
    const summed = addCommitments(c1.commitment, c2.commitment);
    const homo = await verifyHomomorphicProperty(c1, c2);
    expect(homo.left).toEqual(summed);
  });
});
