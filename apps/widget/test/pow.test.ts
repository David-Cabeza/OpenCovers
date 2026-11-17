import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  challengeConfigFromEnv,
  createChallengeVerifier,
  issueChallenge,
  leadingZeroBits as apiLeadingZeroBits,
  solves,
} from "../../api/src/lib/public-challenge";
import { leadingZeroBits, solve } from "../src/pow";

const KEY = "pk_AAAAAAAAAAAAAAAAAAAAAA";

describe("proof of work", () => {
  it("counts leading zero bits as the engine does", () => {
    for (let i = 0; i < 2000; i += 1) {
      const digest = createHash("sha256").update(`probe:${i}`).digest();
      expect(leadingZeroBits(new Uint8Array(digest))).toBe(apiLeadingZeroBits(digest));
    }
    expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
    expect(leadingZeroBits(Uint8Array.from([0, 0x01]))).toBe(15);
  });

  it("finds a solution the engine's check accepts, at the default difficulty and others", async () => {
    for (const difficulty of [0, 1, 8, 12]) {
      const challenge = issueChallenge({ secret: Buffer.alloc(32, 1), difficulty }, KEY);
      const solution = await solve(challenge);
      expect(solution).toMatch(/^[0-9]{1,16}$/);
      expect(solves(challenge.nonce, solution, difficulty)).toBe(true);
    }
  });

  it("passes the engine's full verifier for a challenge the config route would issue", async () => {
    const config = { ...challengeConfigFromEnv({}), difficulty: 12 };
    const issued = Date.now();
    const verifier = createChallengeVerifier(config, { now: () => issued + 5_000 });
    const challenge = issueChallenge(config, KEY, issued);
    const solution = await solve(challenge);
    expect(verifier.verify(KEY, challenge, solution, crypto.randomUUID())).toBe(true);
  });

  it("returns the lowest counter that solves, and reports progress", async () => {
    const challenge = { nonce: "AAAAAAAAAAAAAAAAAAAAAA", difficulty: 10 };
    const progress: number[] = [];
    const solution = Number(await solve(challenge, (tries) => progress.push(tries)));
    for (let n = 0; n < solution; n += 1) expect(solves(challenge.nonce, String(n), 10)).toBe(false);
    expect(progress.every((tries, i) => tries === (i + 1) * 256)).toBe(true);
  });
});
