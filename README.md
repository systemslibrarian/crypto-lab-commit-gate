# crypto-lab-commit-gate

## What It Is
crypto-lab-commit-gate is a browser demo of SHA-256 hash commitments and Pedersen commitments over P-256. It teaches commit/open, computational binding, and hiding through live checks. A one-bit sample illustrates a test for leakage, but cannot prove hiding. Its attacker toggle contrasts a salted hash commitment's computational protection with the perfect hiding of Pedersen commitments when the blinding scalar is uniform. The demo derives the second generator H from a public hash label; because P-256 has prime order, H is mathematically a multiple of G, but the discrete-log relation is assumed hard to find. A diagram illustrates addition of commitments. The auction and coin-flip exercises also show a protocol limit: binding prevents a changed opening, but does not force a participant to reveal.

## When to Use It
- Use commitment schemes in commit-then-reveal protocols such as sealed-bid auctions, because each party can lock a value before learning others' inputs; specify deadlines and rules for a party who withholds an opening.
- Use Pedersen commitments in MPC and ZKP constructions when additive homomorphism is needed, because commitments can be combined and opened as sums.
- Use hash commitments when setup simplicity and broad platform support are priorities, because SHA-256 commitments only require hashing and randomness.
- Do not use unblinded commitments like SHA-256(m) for low-entropy messages, because dictionary attacks can recover the committed value.
- Do NOT use this as production code — it is a teaching demo of the commitment mechanics, not a hardened or audited library.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-commit-gate](https://systemslibrarian.github.io/crypto-lab-commit-gate/)**

The demo walks through six exhibits. The commit/open exhibit lets you **reveal a different message than you sealed and watch verification reject it**. The binding exhibit tries alternate openings and puts its bounded search in context with the ≈ 2¹²⁸ birthday bound for finding *some* SHA-256 collision. The hiding exhibit compares a salted hash commitment with a broken unblinded construction and states the limits of its one-bit sampling experiment. The Pedersen exhibit adds commitments over live P-256 arithmetic and draws their sum. In Exhibit 5, the auction verifies each bid opening but explicitly acknowledges non-reveal; the coin-flip exercise makes Bob commit a bit before Alice chooses hers, then tests honest opening, a rejected changed opening, and selective withholding. A four-case table shows that opening only on result 0 aborts two of four uniformly chosen bit pairs; the display records aborts separately from completed flips. Unit and browser tests cover these outcomes.

## What Can Go Wrong
- Reusing or exposing the blinding factor r breaks hiding, because anyone with r can recompute and test candidate messages.
- Using SHA-256(m) without blinding for predictable inputs enables offline dictionary recovery, because the commitment is deterministic over m alone.
- Biased or weak randomness for r can leak structure across commitments, because repeated or low-entropy blinders make linkage and guessing easier.
- The Pedersen blinder is sampled by rejection from all scalars modulo the P-256 order, including zero; reducing random bytes modulo the order introduces bias. Explicit zero blinding is valid mathematically but not hiding for a fixed chosen commitment.
- Treating Pedersen binding as unconditional is a usage mistake, because binding depends on the discrete-log hardness assumption in the selected group setup.
- Calling H "not a multiple of G" is incorrect in this prime-order group. The mathematical multiple exists; its scalar relation must be unknown and hard to compute. Alternate openings exist mathematically, but computing a second opening for a different message is the binding challenge.
- A commitment cannot compel an opening. A selective abort after seeing the other party's choice can bias completed coin flips if the parties simply repeat until a favorable result.
- This implementation's try-and-increment generator derivation is for teaching; [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380.html) does not recommend that mapping for production because of side-channel concerns. Use reviewed suites and protocols instead.
- Invalid or inconsistent curve arithmetic in Pedersen implementations can produce incorrect verification outcomes, because commitment equations rely on exact group operations.

## Sources

- Dan Boneh and Victor Shoup, [*A Graduate Course in Applied Cryptography*, version 0.6 (2023), §3.12](https://crypto.stanford.edu/~dabo/cryptobook/) — commitment-based coin flipping and aborts.
- [RFC 9380, *Hashing to Elliptic Curves* (August 2023)](https://www.rfc-editor.org/rfc/rfc9380.html) — production mapping and rejection of try-and-increment methods.
- H. Lochbihler et al., [*On the Formalisation of Σ-Protocols and Commitment Schemes* (2019)](https://arxiv.org/abs/1705.05897) — perfect hiding and computational binding of Pedersen commitments.

## Real-World Usage
- Zcash Sapling uses Pedersen commitments on Jubjub for its note commitments; Orchard replaced those with Sinsemilla commitments on Pallas, which is friendlier to Halo 2 lookups. Both still use homomorphic Pedersen commitments for the value commitments that let a circuit balance a transaction.
- Monero uses Pedersen commitments in RingCT and Bulletproof-based range proofs to hide transaction amounts with additive consistency checks.
- Ethereum-style commit-reveal workflows (for example ENS reveal phases and many on-chain games) use hash commitments to lock choices before reveal.
- Threshold signature systems and DKG stacks (including FROST-family workflows) use nonce or share commitments to prevent adaptive tampering across rounds.
- Modern SNARK systems use polynomial commitments (for example KZG-style commitments in proving systems) to bind polynomials while enabling succinct verification.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-commit-gate
cd crypto-lab-commit-gate
npm install
npm run dev
```

## Related Demos
- [crypto-lab-bulletproofs](https://systemslibrarian.github.io/crypto-lab-bulletproofs/) — range proofs built directly on Pedersen commitments over ristretto255.
- [crypto-lab-vss-gate](https://systemslibrarian.github.io/crypto-lab-vss-gate/) — Feldman and Pedersen verifiable secret sharing, which use commitments to detect cheating.
- [crypto-lab-zk-proof-lab](https://systemslibrarian.github.io/crypto-lab-zk-proof-lab/) — Schnorr commitments and Fiat-Shamir, commitments inside an interactive proof.
- [crypto-lab-snark-arena](https://systemslibrarian.github.io/crypto-lab-snark-arena/) — zk-SNARKs whose proving systems rely on polynomial commitments.
- [crypto-lab-frost-threshold](https://systemslibrarian.github.io/crypto-lab-frost-threshold/) — FROST threshold signing, which uses nonce and VSS commitments across rounds.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
