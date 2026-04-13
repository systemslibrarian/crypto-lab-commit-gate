const encoder = new TextEncoder();

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const total = parts.reduce((acc, p) => acc + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
	if (a.length !== b.length) {
		return false;
	}
	let same = 0;
	for (let i = 0; i < a.length; i += 1) {
		same |= a[i] ^ b[i];
	}
	return same === 0;
};

export const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.trim().toLowerCase();
	if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
		throw new Error('Invalid hex string');
	}
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < clean.length; i += 2) {
		out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
	}
	return out;
};

export const randomBlindingFactor = (): Uint8Array => {
	const r = new Uint8Array(32);
	crypto.getRandomValues(r);
	return r;
};

export const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
	const stable = Uint8Array.from(data);
	const digest = await crypto.subtle.digest('SHA-256', stable);
	return new Uint8Array(digest);
};

export const commitHash = async (message: string, r: Uint8Array): Promise<Uint8Array> => {
	const mBytes = encoder.encode(message);
	return sha256(concatBytes(r, mBytes));
};

export const verifyHashOpening = async (message: string, r: Uint8Array, commitment: Uint8Array): Promise<boolean> => {
	const recomputed = await commitHash(message, r);
	return bytesEqual(recomputed, commitment);
};

export type BindingAttemptResult = {
	originalMessage: string;
	originalCommitmentHex: string;
	fixedBlindingHex: string;
	tries: number;
	foundCollision: boolean;
};

export const runBindingAttempt = async (
	originalMessage: string,
	tries = 2000
): Promise<BindingAttemptResult> => {
	const r = randomBlindingFactor();
	const originalCommitment = await commitHash(originalMessage, r);

	let foundCollision = false;
	for (let i = 0; i < tries; i += 1) {
		const candidate = `alt-${i}-${crypto.randomUUID()}`;
		if (candidate === originalMessage) {
			continue;
		}
		const c = await commitHash(candidate, r);
		if (bytesEqual(c, originalCommitment)) {
			foundCollision = true;
			break;
		}
	}

	return {
		originalMessage,
		originalCommitmentHex: bytesToHex(originalCommitment),
		fixedBlindingHex: bytesToHex(r),
		tries,
		foundCollision
	};
};

export type HidingSampleStats = {
	samples: number;
	bit1BiasZero: number;
	bit1BiasOne: number;
	absBiasDelta: number;
};

export const runHidingStats = async (samples = 512): Promise<HidingSampleStats> => {
	let oneCount0 = 0;
	let oneCount1 = 0;

	for (let i = 0; i < samples; i += 1) {
		const r0 = randomBlindingFactor();
		const r1 = randomBlindingFactor();
		const c0 = await commitHash('0', r0);
		const c1 = await commitHash('1', r1);
		oneCount0 += c0[0] & 1;
		oneCount1 += c1[0] & 1;
	}

	const bit1BiasZero = oneCount0 / samples;
	const bit1BiasOne = oneCount1 / samples;

	return {
		samples,
		bit1BiasZero,
		bit1BiasOne,
		absBiasDelta: Math.abs(bit1BiasZero - bit1BiasOne)
	};
};

export const brokenCommitNoBlinding = async (message: string): Promise<Uint8Array> => {
	return sha256(encoder.encode(message));
};

export type DictionaryAttackResult = {
	targetCommitmentHex: string;
	recoveredMessage: string | null;
	attempts: number;
};

export const dictionaryAttackBrokenCommit = async (
	targetCommitmentHex: string,
	dictionary: string[]
): Promise<DictionaryAttackResult> => {
	const target = hexToBytes(targetCommitmentHex);
	for (let i = 0; i < dictionary.length; i += 1) {
		const candidate = dictionary[i];
		const hash = await brokenCommitNoBlinding(candidate);
		if (bytesEqual(hash, target)) {
			return {
				targetCommitmentHex,
				recoveredMessage: candidate,
				attempts: i + 1
			};
		}
	}
	return {
		targetCommitmentHex,
		recoveredMessage: null,
		attempts: dictionary.length
	};
};
