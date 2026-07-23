import type { CrackCandidate, DarknetLearnedPattern } from "./types";

export type { CrackCandidate };

// Tunable guesses, pending real in-game observation - see the plan's "Tunable constants" list.
export const MAX_BRUTEFORCE_KEYSPACE = 2_000_000;
// authenticate()'s speed scales with thread count, and crack workers always dispatch with a
// single thread (RAM is scarce) - confirmed in-game that a 20-candidate sequential batch can
// run far longer than one manager cycle, during which every re-dispatch attempt on the same
// target silently blocks on preventDuplicates. A smaller batch reports back (and lets the
// manager react/reprioritize) sooner, at the cost of a bit more per-dispatch hop-walk overhead.
export const CRACK_BATCH_SIZE = 5;
export const TIER2_CANDIDATE_LIMIT = 50;
export const MAX_ROLLING_ATTEMPTS = 50;

const NUMERIC_CHARSET = "0123456789";
const ALPHABETIC_CHARSET = "abcdefghijklmnopqrstuvwxyz";
const MIN_TOKEN_LENGTH = 2;

// Documented directly in the game's own darknet API docs' example script: this model always
// has an empty password. Worth special-casing eagerly rather than discovering it via brute
// force/dictionary mining, since the game itself hands us the answer.
export const ZERO_LOGON_MODEL_ID = "ZeroLogon";

export function zeroLogonCandidate(): CrackCandidate {
	return { candidate: "", transformId: "zerologon-empty" };
}

export function charsetFor(format: "numeric" | "alphabetic"): string {
	return format === "numeric" ? NUMERIC_CHARSET : ALPHABETIC_CHARSET;
}

export function isBruteForceable(format: string, length: number): boolean {
	if (format !== "numeric" && format !== "alphabetic") return false;
	return keyspaceSize(charsetFor(format).length, length) <= MAX_BRUTEFORCE_KEYSPACE;
}

export function keyspaceSize(charsetLength: number, length: number): number {
	return Math.pow(charsetLength, length);
}

// Resumable mixed-radix encode: index -> the index'th string of `length` chars from `charset`.
export function indexToCandidate(charset: string, length: number, index: number): string {
	const base = charset.length;
	let remaining = index;
	const chars: string[] = new Array(length);
	for (let position = length - 1; position >= 0; position--) {
		chars[position] = charset[remaining % base];
		remaining = Math.floor(remaining / base);
	}
	return chars.join("");
}

function lengthBucket(length: number): string {
	if (length <= 4) return "short";
	if (length <= 8) return "medium";
	return "long";
}

export function hintShapeKey(format: string, length: number, hint: string): string {
	const hasDigits = /[0-9]/.test(hint) ? "digits" : "nodigits";
	return `${format}:${lengthBucket(length)}:${hasDigits}`;
}

function tokenize(text: string): string[] {
	return text
		.split(/[^a-zA-Z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function classPattern(format: string): RegExp | undefined {
	switch (format) {
		case "numeric":
			return /[0-9]/;
		case "alphabetic":
			return /[a-zA-Z]/;
		case "alphanumeric":
			return /[a-zA-Z0-9]/;
		default:
			return undefined;
	}
}

// Strips everything except the target character class from `text`, preserving order - e.g.
// "8╸:#5>(9.╬>8" for a numeric password extracts to "8598". Confirmed live: a
// server's `data` field encoded its password exactly this way, buried in noise characters that
// tokenize() (which splits ON non-alphanumeric runs) can never reconstruct.
function extractInOrder(text: string, format: string): string {
	const charClass = classPattern(format);
	if (!charClass) return "";
	let extracted = "";
	for (const ch of text) {
		if (charClass.test(ch)) extracted += ch;
	}
	return extracted;
}

function matchesFormat(candidate: string, format: string): boolean {
	switch (format) {
		case "numeric":
			return /^[0-9]+$/.test(candidate);
		case "alphabetic":
			return /^[a-zA-Z]+$/.test(candidate);
		case "alphanumeric":
			return /^[a-zA-Z0-9]+$/.test(candidate);
		default:
			// ASCII/unicode: no character-class filter beyond length, the game's charset for
			// these formats isn't documented.
			return true;
	}
}

interface Transform {
	id: string;
	apply: (token: string) => string;
}

// Deliberately no real-world-date guesses (e.g. a current year) - Bitburner's setting has no
// fixed real-world calendar, so digit suffixes stay generic.
const TRANSFORMS: Transform[] = [
	{ id: "identity", apply: (token) => token },
	{ id: "lowercase", apply: (token) => token.toLowerCase() },
	{ id: "uppercase", apply: (token) => token.toUpperCase() },
	{ id: "capitalize", apply: (token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() },
	{ id: "appendDigits:1", apply: (token) => `${token}1` },
	{ id: "appendDigits:12", apply: (token) => `${token}12` },
	{ id: "appendDigits:123", apply: (token) => `${token}123` },
	{
		id: "leet",
		apply: (token) => token.replace(/a/gi, "4").replace(/e/gi, "3").replace(/o/gi, "0").replace(/i/gi, "1").replace(/s/gi, "5"),
	},
];

function transformScore(transformId: string, learned: DarknetLearnedPattern | undefined): number {
	const found = learned?.transforms.find((t) => t.id === transformId);
	return found ? found.successCount - found.failureCount : 0;
}

// Tier 2: mines passwordHint/data/heartbleed-log tokens, ranks candidates by whichever
// transform has historically succeeded most for this hint shape, and caps the result.
// Cross-server learning lives entirely in `patterns` - a single server's queue is just this
// function's output for that server's own hint material, not itself mutated by success/failure.
export function mineDictionaryCandidates(
	hint: string,
	data: string,
	logs: string[],
	format: string,
	length: number,
	patterns: DarknetLearnedPattern[],
): CrackCandidate[] {
	const shapeKey = hintShapeKey(format, length, hint);
	const learned = patterns.find((p) => p.hintShapeKey === shapeKey);
	const rankedTransforms = [...TRANSFORMS].sort((a, b) => transformScore(b.id, learned) - transformScore(a.id, learned));

	const tokens = [...tokenize(hint), ...tokenize(data), ...logs.flatMap((line) => tokenize(line))];

	const seen = new Set<string>();
	const candidates: CrackCandidate[] = [];

	// Strongest, most specific signal first: in-order character-class extraction from each raw
	// source, tried before any token/transform guessing.
	const extractionSources: { label: string; text: string }[] = [
		{ label: "hint", text: hint },
		{ label: "data", text: data },
		...logs.map((line, i) => ({ label: `log${i}`, text: line })),
	];
	for (const source of extractionSources) {
		const extracted = extractInOrder(source.text, format);
		if (extracted.length !== length || !matchesFormat(extracted, format) || seen.has(extracted)) continue;
		seen.add(extracted);
		candidates.push({ candidate: extracted, transformId: `extract-inorder-${source.label}` });
		if (candidates.length >= TIER2_CANDIDATE_LIMIT) return candidates;
	}

	for (const transform of rankedTransforms) {
		for (const token of tokens) {
			const candidate = transform.apply(token);
			if (candidate.length !== length) continue;
			if (!matchesFormat(candidate, format)) continue;
			if (seen.has(candidate)) continue;
			seen.add(candidate);
			candidates.push({ candidate, transformId: transform.id });
			if (candidates.length >= TIER2_CANDIDATE_LIMIT) return candidates;
		}
	}

	return candidates;
}
