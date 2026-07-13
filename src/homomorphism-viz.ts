/*
 * Schematic homomorphism visualization for Pedersen commitments.
 *
 * HONESTY NOTE: real P-256 points are 256-bit and cannot be plotted on a
 * 2D canvas. This is an intentionally STYLIZED picture of the group law, not
 * a plot of the true curve points. What it shows faithfully is the property
 * the exhibit teaches: the map (m, r) ↦ C = r·G + m·H is a group homomorphism,
 * so adding two commitments (tip-to-tail vector addition) lands exactly on the
 * commitment to the summed message and summed blinding. The arithmetic behind
 * the numbers (m₁+m₂, r₁+r₂) is the SAME arithmetic the live P-256 code runs;
 * only the 2D placement is schematic.
 *
 * We embed the group law as a linear map from the pair (m, r) into the plane
 * using two fixed, non-parallel basis directions standing in for m·H and r·G.
 * Because the map is LINEAR, C1 + C2 provably coincides with C(m1+m2, r1+r2)
 * in the picture too — the geometry is not nudged to match, it matches because
 * addition in the exponent is addition of vectors. To keep the two arrows from
 * collapsing onto one line we give each commitment a distinct schematic
 * blinding (its real r is a random 256-bit scalar; the value only has to differ
 * to make the tip-to-tail bend visible), and we normalize the message lengths.
 */

export type VizVector = {
	m: number;
	r: number;
};

// Basis directions for the schematic plane, chosen strongly non-parallel:
// message m contributes "up", blinding r contributes "right".
const H_DIR = { x: 6, y: -34 }; //  contribution of one schematic unit of m
const G_DIR = { x: 40, y: -4 }; //  contribution of one schematic unit of r

const project = (m: number, r: number): { x: number; y: number } => ({
	x: m * H_DIR.x + r * G_DIR.x,
	y: m * H_DIR.y + r * G_DIR.y
});

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/*
 * Build an accessible SVG diagram. Origin O is the identity element. We draw:
 *   - light basis guides for r·G and m·H
 *   - C₁ = r₁·G + m₁·H as one arrow from O
 *   - C₂ drawn tip-to-tail from C₁'s tip
 *   - C(m₁+m₂, r₁+r₂) as the resultant arrow from O, landing on C₂'s tip
 * The coincidence of "C₁ then C₂" with the direct resultant is the lesson.
 */
export const renderHomomorphismSvg = (c1: VizVector, c2: VizVector): string => {
	// Normalize the two real messages to a small, balanced schematic length so
	// the picture stays legible whatever the actual m₁, m₂ are, while keeping
	// their RATIO (so a bigger message really is a longer arrow).
	const rawM1 = Math.max(0, c1.m);
	const rawM2 = Math.max(0, c2.m);
	const maxRaw = Math.max(rawM1, rawM2, 1);
	const sm1 = 1 + (rawM1 / maxRaw) * 3.2; // schematic message magnitude, ~1..4.2
	const sm2 = 1 + (rawM2 / maxRaw) * 3.2;

	// Distinct schematic blinding per commitment so the arrows fan apart. Real r
	// is a uniform 256-bit scalar; here we only need two different, non-zero
	// values to keep C₁ and C₂ off a single line.
	const r1 = 2.6;
	const r2 = 0.6;

	const p1 = project(sm1, r1);
	const pSum = project(sm1 + sm2, r1 + r2);

	// Fit the canvas to everything we draw (arrows can go up/right).
	const xs = [0, p1.x, pSum.x, G_DIR.x * (r1 + r2), H_DIR.x * (sm1 + sm2)];
	const ys = [0, p1.y, pSum.y, H_DIR.y * (sm1 + sm2), G_DIR.y * (r1 + r2)];
	const pad = 46;
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	// Extra room on the right for the longest text label, which sits at the sum
	// tip and extends well past the geometry.
	const labelPad = 150;
	const w = maxX - minX + pad * 2 + labelPad;
	const h = maxY - minY + pad * 2;
	// Origin placed so all content fits with padding.
	const ox = pad - minX;
	const oy = pad - minY;

	const X = (x: number): number => ox + x;
	const Y = (y: number): number => oy + y;

	const line = (x1: number, y1: number, x2: number, y2: number, cls: string, marker = true): string =>
		`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" class="${cls}"${marker ? ' marker-end="url(#hv-arrow)"' : ''} />`;

	const dot = (x: number, y: number, cls: string): string =>
		`<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4.5" class="${cls}" />`;

	const label = (x: number, y: number, text: string, cls: string, dx = 8, dy = -6): string =>
		`<text x="${(X(x) + dx).toFixed(1)}" y="${(Y(y) + dy).toFixed(1)}" class="${cls}">${text}</text>`;

	const sumM = rawM1 + rawM2;
	const desc =
		`Schematic vector diagram. The commitment arrow for message ${fmt(rawM1)} ` +
		`added tip to tail to the arrow for message ${fmt(rawM2)} lands on the ` +
		`commitment to their sum ${fmt(sumM)}, illustrating the additive homomorphism.`;

	// Guide endpoints (shortened so they read as axes, not vectors).
	const gEnd = { x: G_DIR.x * (r1 + r2) * 0.72, y: G_DIR.y * (r1 + r2) * 0.72 };
	const hEnd = { x: H_DIR.x * (sm1 + sm2) * 0.72, y: H_DIR.y * (sm1 + sm2) * 0.72 };

	return `
	<figure class="homo-viz">
	  <svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" role="img" aria-label="${desc}" class="homo-svg" preserveAspectRatio="xMidYMid meet">
	    <defs>
	      <marker id="hv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
	        <path d="M 0 0 L 10 5 L 0 10 z" class="hv-arrowhead" />
	      </marker>
	    </defs>
	    <!-- basis guides -->
	    ${line(0, 0, gEnd.x, gEnd.y, 'hv-guide', false)}
	    ${line(0, 0, hEnd.x, hEnd.y, 'hv-guide', false)}
	    ${label(gEnd.x, gEnd.y, 'r·G', 'hv-guide-label', 6, 14)}
	    ${label(hEnd.x, hEnd.y, 'm·H', 'hv-guide-label', 6, 0)}
	    <!-- C₁ from origin -->
	    ${line(0, 0, p1.x, p1.y, 'hv-c1')}
	    <!-- C₂ tip-to-tail from C₁'s tip -->
	    ${line(p1.x, p1.y, pSum.x, pSum.y, 'hv-c2')}
	    <!-- resultant C(m₁+m₂) from origin -->
	    ${line(0, 0, pSum.x, pSum.y, 'hv-sum')}
	    ${dot(0, 0, 'hv-origin')}
	    ${dot(p1.x, p1.y, 'hv-c1-dot')}
	    ${dot(pSum.x, pSum.y, 'hv-sum-dot')}
	    ${label(0, 0, 'O', 'hv-lbl', -16, 16)}
	    ${label(p1.x, p1.y, `C₁ (m=${fmt(rawM1)})`, 'hv-lbl hv-lbl-c1', -6, -10)}
	    ${label((p1.x + pSum.x) / 2, (p1.y + pSum.y) / 2, `C₂ (m=${fmt(rawM2)})`, 'hv-lbl hv-lbl-c2', 10, -4)}
	    ${label(pSum.x, pSum.y, `C(m₁+m₂=${fmt(sumM)})`, 'hv-lbl hv-lbl-sum', 10, 4)}
	  </svg>
	  <figcaption>
	    Schematic of the group law (not true P-256 coordinates): adding the sealed
	    arrows <span class="hv-key hv-key-c1">C₁</span> and
	    <span class="hv-key hv-key-c2">C₂</span> tip-to-tail lands exactly on
	    <span class="hv-key hv-key-sum">C(m₁+m₂)</span> — the green resultant — so
	    the sum opens correctly without ever unsealing either value.
	  </figcaption>
	</figure>`;
};
