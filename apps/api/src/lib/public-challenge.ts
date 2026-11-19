import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ADR-0017 section 3: a signed form challenge with a minimum fill time and a small proof of work.

export interface FormChallenge {
  nonce: string;
  issuedAt: string;
  difficulty: number;
  signature: string;
}

export interface ChallengeConfig {
  secret: Buffer;
  difficulty: number;
}

export const MIN_AGE_MS = 3_000;
export const MAX_AGE_MS = 30 * 60_000;
// Measured with Node's async crypto.subtle.digest, about 11,000 hashes a second on a laptop: 12 bits
// (4,096 tries on average) is under half a second there. A browser worker hashes faster. The phone
// measurement of Q7 waits for the widget (stage 5).
export const DEFAULT_DIFFICULTY = 12;
const MAX_DIFFICULTY = 32;
const MAX_NONCES = 100_000;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const SOLUTION = /^[0-9]{1,16}$/;

type Env = Record<string, string | undefined>;

export function challengeConfigFromEnv(env: Env = process.env): ChallengeConfig {
  const rawDifficulty = env.PUBLIC_POW_DIFFICULTY;
  let difficulty = DEFAULT_DIFFICULTY;
  if (rawDifficulty !== undefined && rawDifficulty !== "") {
    difficulty = Number(rawDifficulty);
    if (!/^\d+$/.test(rawDifficulty) || difficulty > MAX_DIFFICULTY) {
      throw new Error(`PUBLIC_POW_DIFFICULTY must be an integer from 0 to ${MAX_DIFFICULTY}. Got "${rawDifficulty}".`);
    }
  }
  const rawSecret = env.PUBLIC_CHALLENGE_SECRET;
  if (rawSecret !== undefined && rawSecret !== "" && rawSecret.length < 32) {
    throw new Error("PUBLIC_CHALLENGE_SECRET must be at least 32 characters.");
  }
  return {
    // Without a configured secret each process signs with its own, so a restart voids open challenges.
    secret: rawSecret ? Buffer.from(rawSecret, "utf8") : randomBytes(32),
    difficulty,
  };
}

/** The startup log line for the challenge settings, and the warnings a production instance should see. */
export function describeChallenge(config: ChallengeConfig, env: Env = process.env): { line: string; warnings: string[] } {
  const keyed = Boolean(env.PUBLIC_CHALLENGE_SECRET);
  const line = `public challenge: difficulty ${config.difficulty}, signed with ${keyed ? "PUBLIC_CHALLENGE_SECRET" : "a per-process key"}`;
  if (env.NODE_ENV !== "production") return { line, warnings: [] };
  const warnings: string[] = [];
  if (config.difficulty === 0) {
    warnings.push("PUBLIC_POW_DIFFICULTY=0: the proof of work is off for public bookings. Only the signed challenge and the minimum fill time remain.");
  }
  if (!keyed) {
    warnings.push("PUBLIC_CHALLENGE_SECRET is not set: a restart voids open challenges, and several API processes reject each other's.");
  }
  return { line, warnings };
}

/**
 * What a challenge is for. The purpose is part of the signed text, so a challenge issued for one purpose never
 * verifies for another: a magic-link challenge cannot book a table and a booking challenge cannot mail a link.
 * `subject` is what the challenge is bound to: the booking key, or the normalized address of a magic link.
 */
export type ChallengePurpose = "booking" | "magic-link";

function sign(secret: Buffer, purpose: ChallengePurpose, subject: string, nonce: string, issuedAt: string, difficulty: number): string {
  return createHmac("sha256", secret)
    .update(`v2\n${purpose}\n${subject}\n${nonce}\n${issuedAt}\n${difficulty}`)
    .digest("base64url");
}

export function issueChallenge(
  config: ChallengeConfig,
  subject: string,
  at: number = Date.now(),
  purpose: ChallengePurpose = "booking",
): FormChallenge {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = new Date(at).toISOString();
  return {
    nonce,
    issuedAt,
    difficulty: config.difficulty,
    signature: sign(config.secret, purpose, subject, nonce, issuedAt, config.difficulty),
  };
}

export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function solves(nonce: string, solution: string, difficulty: number): boolean {
  return leadingZeroBits(createHash("sha256").update(`${nonce}:${solution}`, "utf8").digest()) >= difficulty;
}

/** Brute-forces a solution. For tests and tooling; the widget does the same in a Web Worker. */
export function solve(challenge: Pick<FormChallenge, "nonce" | "difficulty">): string {
  for (let counter = 0; ; counter += 1) {
    if (solves(challenge.nonce, String(counter), challenge.difficulty)) return String(counter);
  }
}

export function parseChallenge(value: unknown): FormChallenge | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { nonce, issuedAt, difficulty, signature } = value as Record<string, unknown>;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return null;
  if (typeof issuedAt !== "string" || typeof signature !== "string" || signature.length > 64) return null;
  if (typeof difficulty !== "number" || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > MAX_DIFFICULTY) {
    return null;
  }
  return { nonce, issuedAt, difficulty, signature };
}

export function isSolution(value: unknown): value is string {
  return typeof value === "string" && SOLUTION.test(value);
}

/**
 * Verifies challenges and remembers each accepted nonce for its 30-minute life, in memory, as the rate limiter
 * keeps its counters. A nonce is bound to the `Idempotency-Key` that first presented it, so a retry of the same
 * submit passes and replays through the create's idempotency, and any other submit with that nonce is refused.
 */
export interface VerifierOptions {
  now?: () => number;
  maxNonces?: number;
  purpose?: ChallengePurpose;
  /** Booking forms wait 3 seconds before they accept a submit. A magic-link form has no use for that wait. */
  minAgeMs?: number;
  maxAgeMs?: number;
  /** A nonce verifies once, whatever the `idempotencyKey`. A booking retries through its idempotency key instead. */
  singleUse?: boolean;
}

export function createChallengeVerifier(config: ChallengeConfig, options: VerifierOptions = {}) {
  const now = options.now ?? Date.now;
  const purpose = options.purpose ?? "booking";
  const minAge = options.minAgeMs ?? MIN_AGE_MS;
  const maxAge = options.maxAgeMs ?? MAX_AGE_MS;
  const singleUse = options.singleUse ?? false;
  const maxNonces = options.maxNonces ?? MAX_NONCES;
  const seen = new Map<string, { idempotencyKey: string; expiresAt: number }>();

  function sweep(at: number) {
    for (const [nonce, entry] of seen) {
      if (at >= entry.expiresAt) seen.delete(nonce);
    }
    // Still full of live nonces: drop the earliest accepted. This bounds memory, and so bounds replay protection
    // to the most recent MAX_NONCES creates, which the public_booking and public_venue limits keep far away.
    while (seen.size >= maxNonces) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  function verify(subject: string, challenge: FormChallenge, solution: string, idempotencyKey = ""): boolean {
    const at = now();
    const issued = Date.parse(challenge.issuedAt);
    if (Number.isNaN(issued) || new Date(issued).toISOString() !== challenge.issuedAt) return false;
    const expected = Buffer.from(
      sign(config.secret, purpose, subject, challenge.nonce, challenge.issuedAt, challenge.difficulty),
    );
    const given = Buffer.from(challenge.signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    const age = at - issued;
    if (age < minAge || age > maxAge) return false;
    if (!solves(challenge.nonce, solution, challenge.difficulty)) return false;
    const used = seen.get(challenge.nonce);
    if (used && at < used.expiresAt) return !singleUse && used.idempotencyKey === idempotencyKey;
    if (seen.size >= maxNonces) sweep(at);
    seen.set(challenge.nonce, { idempotencyKey, expiresAt: issued + maxAge });
    return true;
  }

  return { verify, size: () => seen.size };
}
