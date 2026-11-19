// The proof of work a magic link request carries (ADR-0022, decisions 6 and 8a). It is the public booking form's
// signed challenge (lib/public-challenge.ts: minimum fill time, small proof of work, PUBLIC_POW_DIFFICULTY and
// PUBLIC_CHALLENGE_SECRET) under its own key name, so a challenge from one form never opens the other.
//
//   GET  /api/demo/challenge                      -> { nonce, issuedAt, difficulty, signature }
//   POST /api/auth/sign-in/magic-link
//        X-Demo-Challenge: <that JSON, as sent>
//        X-Demo-Solution:  <a decimal counter such that sha256(`${nonce}:${solution}`) has `difficulty` leading zero bits>
//
// A challenge is valid from 3 seconds to 30 minutes after it was issued and works once.
import { randomUUID } from "node:crypto";
import {
  challengeConfigFromEnv,
  createChallengeVerifier,
  isSolution,
  issueChallenge,
  parseChallenge,
  type ChallengeConfig,
  type FormChallenge,
} from "../lib/public-challenge";

export const CHALLENGE_HEADER = "x-demo-challenge";
export const SOLUTION_HEADER = "x-demo-solution";
const FORM = "demo-sign-in";

let state: { config: ChallengeConfig; verify: ReturnType<typeof createChallengeVerifier>["verify"] } | undefined;

function ready() {
  if (!state) {
    const config = challengeConfigFromEnv();
    state = { config, verify: createChallengeVerifier(config).verify };
  }
  return state;
}

/** A fresh challenge. `at` is for tests, which need one old enough to pass the minimum fill time. */
export function issueSignInChallenge(at?: number): FormChallenge {
  return issueChallenge(ready().config, FORM, at);
}

/** True when the request carries a valid, unused challenge and a solution for it. */
export function verifySignInChallenge(headers: Headers | undefined): boolean {
  const raw = headers?.get(CHALLENGE_HEADER);
  const solution = headers?.get(SOLUTION_HEADER) ?? undefined;
  if (!raw || raw.length > 512 || !isSolution(solution)) return false;
  let parsed: FormChallenge | null;
  try {
    parsed = parseChallenge(JSON.parse(raw));
  } catch {
    return false;
  }
  if (!parsed) return false;
  // A fresh key per request makes the challenge single use: presenting the nonce again carries another key.
  return ready().verify(FORM, parsed, solution, randomUUID());
}
