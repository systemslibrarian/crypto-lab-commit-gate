export type CoinCase = {
  bob: 0 | 1;
  alice: 0 | 1;
  honestOutcome: 0 | 1;
  selectiveOutcome: 0 | null;
};

export const coinOutcome = (bob: 0 | 1, alice: 0 | 1): 0 | 1 =>
  (bob ^ alice) as 0 | 1;

// A selective abort can bias the outcomes of completed runs, but cannot
// silently turn an unfavorable run into the desired outcome. Record the abort.
export const selectiveAbortCases = (): CoinCase[] =>
  ([0, 1] as const).flatMap((bob) =>
    ([0, 1] as const).map((alice) => {
      const honestOutcome = coinOutcome(bob, alice);
      return {
        bob,
        alice,
        honestOutcome,
        selectiveOutcome: honestOutcome === 0 ? 0 : null
      };
    })
  );
