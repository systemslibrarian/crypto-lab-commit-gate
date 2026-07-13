# crypto-lab-commit-gate

## What It Is
crypto-lab-commit-gate is a browser demo of two commitment primitives implemented in code as SHA-256 hash commitments and Pedersen commitments over P-256. It shows the commit/open lifecycle, the binding property, and the hiding property with interactive checks tied to live computations. The lab contrasts computational hiding in hash commitments with information-theoretic hiding in Pedersen commitments — including a toggle that lets an unlimited-compute attacker break hash hiding while Pedersen still leaks nothing — and it includes a broken no-blinding construction to demonstrate failure modes. The Pedersen second generator H is derived by hash-to-curve (try-and-increment on P-256) so its discrete log base G is unknown to everyone; that unknown relationship is exactly what makes the commitment binding, and the demo shows why. A schematic vector diagram makes the additive homomorphism geometric: adding two sealed commitments tip-to-tail lands on the commitment to the summed value. The problem it addresses is how to bind a value now and reveal it later without allowing undetected changes or premature disclosure.

## When to Use It
- Use commitment schemes in commit-then-reveal protocols such as sealed-bid auctions, because each party can lock a value before learning others' inputs.
- Use Pedersen commitments in MPC and ZKP constructions when additive homomorphism is needed, because commitments can be combined and opened as sums.
- Use hash commitments when setup simplicity and broad platform support are priorities, because SHA-256 commitments only require hashing and randomness.
- Do not use unblinded commitments like SHA-256(m) for low-entropy messages, because dictionary attacks can recover the committed value.
- Do NOT use this as production code — it is a teaching demo of the commitment mechanics, not a hardened or audited library.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-commit-gate](https://systemslibrarian.github.io/crypto-lab-commit-gate/)**

The demo opens with a plain-language primer (the commit→open→verify lifecycle plus the binding and hiding properties) and a symbol legend, then walks through six interactive exhibits. Each exhibit shows its governing equation, runs real in-browser cryptography, and reports an interpreted verdict — a plain-English headline explaining what just happened and why it matters — alongside the raw values. The commit/open exhibit lets you **reveal a different message than you sealed and watch verification reject it**, making the binding property tangible; the binding exhibit lets you keep trying to find a colliding message and pairs each (always-failing) batch with an honest "work remaining" meter anchored to the ≈ 2¹²⁸ hashes a real collision needs — so the point is the size of the search space, not that a few thousand tries missed. The hiding exhibit contrasts a properly blinded commitment against a broken unblinded one that falls to a live dictionary attack, and adds a side-by-side computational-vs-information-theoretic panel with an infinite-compute-attacker toggle. The Pedersen exhibit derives H by hash-to-curve, states plainly why binding requires an unknown log_G(H), adds two commitments without opening them, and draws the sum as a tip-to-tail vector addition. The sealed-bid auction shows commit-then-reveal removing any last-look advantage. The commitment primitives are covered by a vitest suite that runs in CI.

## What Can Go Wrong
- Reusing or exposing the blinding factor r breaks hiding, because anyone with r can recompute and test candidate messages.
- Using SHA-256(m) without blinding for predictable inputs enables offline dictionary recovery, because the commitment is deterministic over m alone.
- Biased or weak randomness for r can leak structure across commitments, because repeated or low-entropy blinders make linkage and guessing easier.
- Treating Pedersen binding as unconditional is a usage mistake, because binding depends on the discrete-log hardness assumption in the selected group setup.
- Invalid or inconsistent curve arithmetic in Pedersen implementations can produce incorrect verification outcomes, because commitment equations rely on exact group operations.

## Real-World Usage
- Zcash Sapling and Orchard use Pedersen commitments to hide note values while preserving algebra needed by zero-knowledge circuits.
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

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
