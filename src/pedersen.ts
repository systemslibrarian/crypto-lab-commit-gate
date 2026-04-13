const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const A = BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc');
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

const deriveH = async (): Promise<Point> => {
	const data = new TextEncoder().encode('crypto-lab-commit-gate/pedersen/H');
	const digest = await crypto.subtle.digest('SHA-256', data.buffer);
	const s = mod(bytesToBigint(new Uint8Array(digest)), N - 1n) + 1n;
	const h = scalarMultiply(s, G);
	if (isInfinity(h)) {
		throw new Error('Invalid derived H');
	}
	return h;
};

let cachedH: Point | null = null;

export const getGenerators = async (): Promise<{ G: Point; H: Point }> => {
	if (!cachedH) {
		cachedH = await deriveH();
	}
	return { G, H: cachedH };
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
