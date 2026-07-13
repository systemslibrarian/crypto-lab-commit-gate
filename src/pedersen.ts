const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const A = BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc');
const B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

type Point = {
	x: bigint;
	y: bigint;
	inf?: false;
};

type InfinityPoint = { inf: true };

export type EcPoint = Point | InfinityPoint;

export type PedersenCommitment = {
	commitment: EcPoint;
	messageScalar: bigint;
	blindingScalar: bigint;
};

const G: Point = {
	x: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
	y: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')
};

const mod = (v: bigint, m: bigint): bigint => {
	const r = v % m;
	return r >= 0n ? r : r + m;
};

const modInv = (a: bigint, m: bigint): bigint => {
	let t = 0n;
	let newT = 1n;
	let r = m;
	let newR = mod(a, m);

	while (newR !== 0n) {
		const q = r / newR;
		[t, newT] = [newT, t - q * newT];
		[r, newR] = [newR, r - q * newR];
	}

	if (r !== 1n) {
		throw new Error('No inverse exists');
	}
	return mod(t, m);
};

const isInfinity = (p: EcPoint): p is InfinityPoint => p.inf === true;

const pointAdd = (p: EcPoint, q: EcPoint): EcPoint => {
	if (isInfinity(p)) {
		return q;
	}
	if (isInfinity(q)) {
		return p;
	}
	if (p.x === q.x && mod(p.y + q.y, P) === 0n) {
		return { inf: true };
	}

	let lambda: bigint;
	if (p.x === q.x && p.y === q.y) {
		const numerator = mod(3n * p.x * p.x + A, P);
		const denominator = modInv(2n * p.y, P);
		lambda = mod(numerator * denominator, P);
	} else {
		const numerator = mod(q.y - p.y, P);
		const denominator = modInv(mod(q.x - p.x, P), P);
		lambda = mod(numerator * denominator, P);
	}

	const rx = mod(lambda * lambda - p.x - q.x, P);
	const ry = mod(lambda * (p.x - rx) - p.y, P);
	return { x: rx, y: ry };
};

const scalarMultiply = (k: bigint, p: EcPoint): EcPoint => {
	let n = mod(k, N);
	if (n === 0n || isInfinity(p)) {
		return { inf: true };
	}

	let result: EcPoint = { inf: true };
	let addend: EcPoint = p;

	while (n > 0n) {
		if ((n & 1n) === 1n) {
			result = pointAdd(result, addend);
		}
		addend = pointAdd(addend, addend);
		n >>= 1n;
	}
	return result;
};

const bytesToBigint = (bytes: Uint8Array): bigint => {
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return BigInt(`0x${hex || '00'}`);
};

const randomScalar = (): bigint => {
	const bytes = new Uint8Array(32);
	while (true) {
		crypto.getRandomValues(bytes);
		const k = mod(bytesToBigint(bytes), N);
		if (k !== 0n) {
			return k;
		}
	}
};

/* Modular exponentiation, needed for the square root below. */
const modPow = (base: bigint, exp: bigint, m: bigint): bigint => {
	let result = 1n;
	let b = mod(base, m);
	let e = exp;
	while (e > 0n) {
		if ((e & 1n) === 1n) {
			result = mod(result * b, m);
		}
		b = mod(b * b, m);
		e >>= 1n;
	}
	return result;
};

/* Square root mod P. P-256's prime satisfies P ≡ 3 (mod 4), so a square root
 * of a (when one exists) is a^((P+1)/4) mod P. Returns null if a is a
 * non-residue (the candidate x had no matching y on the curve). */
const sqrtModP = (a: bigint): bigint | null => {
	if (a === 0n) {
		return 0n;
	}
	const r = modPow(a, (P + 1n) / 4n, P);
	return mod(r * r, P) === mod(a, P) ? r : null;
};

/*
 * Derive the second Pedersen generator H by HASH-TO-CURVE (try-and-increment),
 * NOT as a scalar multiple of G.
 *
 * WHY THIS MATTERS FOR BINDING: if H = s·G for a KNOWN scalar s, then a
 * committer knows log_G(H) = s and can open a single commitment to two
 * different messages:
 *     C = r·G + m·H = (r + s·m)·G
 * so any (m', r') with r' + s·m' = r + s·m opens the same C — binding is BROKEN.
 * Deriving H by hashing to a curve point makes log_G(H) unknown to everyone, so
 * finding such an (m', r') would require solving a discrete log. That unknown
 * relationship is exactly what makes Pedersen commitments binding.
 *
 * Method: hash a domain-separated label to a field element x, try to solve the
 * curve equation y² = x³ + a·x + b for y; if x is not the abscissa of a curve
 * point, increment a counter and rehash. Nobody (including us) learns the
 * discrete log of the resulting H base G.
 */
const deriveH = async (): Promise<Point> => {
	const encoder = new TextEncoder();
	for (let counter = 0; counter < 1024; counter += 1) {
		const label = `crypto-lab-commit-gate/pedersen/H/hash-to-curve/${counter}`;
		const digest = await crypto.subtle.digest('SHA-256', encoder.encode(label));
		const x = mod(bytesToBigint(new Uint8Array(digest)), P);
		const rhs = mod(mod(x * x * x, P) + mod(A * x, P) + B, P);
		const y = sqrtModP(rhs);
		if (y === null) {
			continue;
		}
		// Pick the even-y root deterministically so H is reproducible.
		const yFinal = (y & 1n) === 0n ? y : mod(P - y, P);
		const h: Point = { x, y: yFinal };
		// Sanity: H must be a real, non-identity point on the curve.
		const onCurve = mod(yFinal * yFinal, P) === rhs;
		if (!onCurve || isInfinity(h)) {
			continue;
		}
		return h;
	}
	throw new Error('Failed to hash-to-curve for H');
};

let cachedH: Point | null = null;

export const getGenerators = async (): Promise<{ G: Point; H: Point }> => {
	if (!cachedH) {
		cachedH = await deriveH();
	}
	return { G, H: cachedH };
};

/* Curve membership check, exported so tests can assert H is a genuine P-256
 * point produced by hash-to-curve (not fabricated). */
export const isOnCurve = (p: EcPoint): boolean => {
	if (isInfinity(p)) {
		return false;
	}
	const lhs = mod(p.y * p.y, P);
	const rhs = mod(mod(p.x * p.x * p.x, P) + mod(A * p.x, P) + B, P);
	return lhs === rhs;
};

export const pointToHex = (p: EcPoint): string => {
	if (isInfinity(p)) {
		return 'INF';
	}
	return `(${p.x.toString(16)}, ${p.y.toString(16)})`;
};

export const commitPedersen = async (message: bigint, blinding?: bigint): Promise<PedersenCommitment> => {
	const { H } = await getGenerators();
	const m = mod(message, N);
	const r = blinding ? mod(blinding, N) : randomScalar();
	const mH = scalarMultiply(m, H);
	const rG = scalarMultiply(r, G);
	const commitment = pointAdd(rG, mH);

	return {
		commitment,
		messageScalar: m,
		blindingScalar: r
	};
};

export const verifyPedersenOpening = async (opening: PedersenCommitment): Promise<boolean> => {
	const recalculated = await commitPedersen(opening.messageScalar, opening.blindingScalar);
	if (isInfinity(opening.commitment) || isInfinity(recalculated.commitment)) {
		return false;
	}
	return opening.commitment.x === recalculated.commitment.x && opening.commitment.y === recalculated.commitment.y;
};

export const addCommitments = (a: EcPoint, b: EcPoint): EcPoint => pointAdd(a, b);

export type HomomorphicCheck = {
	left: EcPoint;
	right: EcPoint;
	sumMessage: bigint;
	sumBlinding: bigint;
	ok: boolean;
};

export const verifyHomomorphicProperty = async (
	c1: PedersenCommitment,
	c2: PedersenCommitment
): Promise<HomomorphicCheck> => {
	const left = addCommitments(c1.commitment, c2.commitment);
	const sumMessage = mod(c1.messageScalar + c2.messageScalar, N);
	const sumBlinding = mod(c1.blindingScalar + c2.blindingScalar, N);
	const reopened = await commitPedersen(sumMessage, sumBlinding);
	const right = reopened.commitment;

	const ok =
		!isInfinity(left) &&
		!isInfinity(right) &&
		left.x === right.x &&
		left.y === right.y;

	return {
		left,
		right,
		sumMessage,
		sumBlinding,
		ok
	};
};
