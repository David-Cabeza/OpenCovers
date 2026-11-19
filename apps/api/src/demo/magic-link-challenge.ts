import {
  challengeConfigFromEnv,
  createChallengeVerifier,
  isSolution,
  issueChallenge,
  parseChallenge,
  type ChallengeConfig,
  type FormChallenge,
  type VerifierOptions,
} from "../lib/public-challenge";

// ADR-0022, decision 8(a): a magic link needs the proof-of-work challenge of ADR-0017. Same scheme as the booking
// widget's, with purpose "magic-link" and the normalized address as the subject. One use, five minutes (the life of
// the link it unlocks), no minimum fill time.

/** Request headers that carry the answer: the challenge as JSON, and the solution. */
export const CHALLENGE_HEADER = "x-demo-challenge";
export const SOLUTION_HEADER = "x-demo-solution";

export const CHALLENGE_MAX_AGE_MS = 5 * 60_000;

export type ChallengeRefusal = "CHALLENGE_REQUIRED" | "CHALLENGE_INVALID";

/** The address a challenge and the per-address limits are kept for. Same normalization as lib/rate-limit.ts. */
export function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function createMagicLinkChallenges(config: ChallengeConfig, options: Pick<VerifierOptions, "now" | "maxNonces"> = {}) {
  const now = options.now ?? Date.now;
  const verifier = createChallengeVerifier(config, {
    ...options,
    purpose: "magic-link",
    minAgeMs: 0,
    maxAgeMs: CHALLENGE_MAX_AGE_MS,
    singleUse: true,
  });

  return {
    issue(email: string): { challenge: FormChallenge; expiresAt: string } {
      const at = now();
      return {
        challenge: issueChallenge(config, normalizeAddress(email), at, "magic-link"),
        expiresAt: new Date(at + CHALLENGE_MAX_AGE_MS).toISOString(),
      };
    },
    /** Null when the request may proceed, else why not. Accepting a challenge spends it. */
    check(email: string, headers: Headers | undefined): ChallengeRefusal | null {
      const rawChallenge = headers?.get(CHALLENGE_HEADER);
      const solution = headers?.get(SOLUTION_HEADER);
      if (!rawChallenge || !solution) return "CHALLENGE_REQUIRED";
      let parsed: FormChallenge | null = null;
      try {
        parsed = parseChallenge(JSON.parse(rawChallenge));
      } catch {
        return "CHALLENGE_INVALID";
      }
      if (!parsed || !isSolution(solution)) return "CHALLENGE_INVALID";
      return verifier.verify(normalizeAddress(email), parsed, solution) ? null : "CHALLENGE_INVALID";
    },
    size: verifier.size,
  };
}

export type MagicLinkChallenges = ReturnType<typeof createMagicLinkChallenges>;

/** The process-wide instance: the endpoint that issues and the auth hook that checks must share one key and one nonce set. */
let shared: MagicLinkChallenges | undefined;
export function magicLinkChallenges(): MagicLinkChallenges {
  shared ??= createMagicLinkChallenges(challengeConfigFromEnv());
  return shared;
}
