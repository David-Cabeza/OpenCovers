import { describe, expect, it } from "vitest";
import {
  challengeConfigFromEnv,
  createChallengeVerifier,
  DEFAULT_DIFFICULTY,
  issueChallenge,
  leadingZeroBits,
  solve,
  solves,
} from "../src/lib/public-challenge";

const SECRET = "a-test-secret-that-is-long-enough-to-use";
const KEY = "pk_AAAAAAAAAAAAAAAAAAAAAA";

describe("challenge settings", () => {
  it("defaults to a low difficulty and lets 0 turn the proof of work off", () => {
    expect(challengeConfigFromEnv({}).difficulty).toBe(DEFAULT_DIFFICULTY);
    expect(DEFAULT_DIFFICULTY).toBe(12);
    expect(challengeConfigFromEnv({ PUBLIC_POW_DIFFICULTY: "0" }).difficulty).toBe(0);
    expect(challengeConfigFromEnv({ PUBLIC_POW_DIFFICULTY: "" }).difficulty).toBe(DEFAULT_DIFFICULTY);
  });

  it("stops startup on a bad difficulty or a short secret", () => {
    for (const value of ["-1", "33", "1.5", "lots"]) {
      expect(() => challengeConfigFromEnv({ PUBLIC_POW_DIFFICULTY: value })).toThrow(/PUBLIC_POW_DIFFICULTY/);
    }
    expect(() => challengeConfigFromEnv({ PUBLIC_CHALLENGE_SECRET: "short" })).toThrow(/PUBLIC_CHALLENGE_SECRET/);
  });

  it("signs with a random key when none is set, so another process cannot forge a challenge", () => {
    const a = challengeConfigFromEnv({});
    const b = challengeConfigFromEnv({});
    const challenge = issueChallenge(a, KEY, 0);
    const verifier = createChallengeVerifier(b, { now: () => 10_000 });
    expect(verifier.verify(KEY, challenge, solve(challenge), "k")).toBe(false);
  });
});

describe("proof of work", () => {
  it("counts leading zero bits of SHA-256 of nonce:solution", () => {
    expect(leadingZeroBits(Buffer.from([0, 0, 0x10, 0xff]))).toBe(19);
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.alloc(4))).toBe(32);
    const solution = solve({ nonce: "n", difficulty: 10 });
    expect(solves("n", solution, 10)).toBe(true);
    expect(solves("other", solution, 30)).toBe(false);
  });
});

describe("challenge verifier", () => {
  const config = { secret: Buffer.from(SECRET), difficulty: 2 };

  it("accepts a challenge between 3 seconds and 30 minutes old, and nothing outside", () => {
    let now = 0;
    const verifier = createChallengeVerifier(config, { now: () => now });
    const at = (ms: number) => {
      const challenge = issueChallenge(config, KEY, 0);
      now = ms;
      return verifier.verify(KEY, challenge, solve(challenge), crypto.randomUUID());
    };
    expect(at(2_999)).toBe(false);
    expect(at(3_000)).toBe(true);
    expect(at(30 * 60_000)).toBe(true);
    expect(at(30 * 60_000 + 1)).toBe(false);
  });

  it("forgets a nonce after its life and bounds the memory it keeps", () => {
    let now = 5_000;
    const verifier = createChallengeVerifier(config, { now: () => now, maxNonces: 3 });
    const issued = Array.from({ length: 5 }, () => issueChallenge(config, KEY, 0));
    for (const c of issued) expect(verifier.verify(KEY, c, solve(c), "k1")).toBe(true);
    expect(verifier.size()).toBeLessThanOrEqual(3);
    expect(verifier.verify(KEY, issued[4]!, solve(issued[4]!), "k2")).toBe(false);
    now = 31 * 60_000;
    const late = issueChallenge(config, KEY, now - 5_000);
    expect(verifier.verify(KEY, late, solve(late), "k3")).toBe(true);
    expect(verifier.size()).toBe(1);
  });
});
