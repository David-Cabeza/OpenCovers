import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { signupMode } from "../src/lib/signup";

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  delete process.env.SIGNUP;
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  delete process.env.SIGNUP;
});

let n = 0;
function signUp(extra: Record<string, unknown> = {}) {
  n += 1;
  return auth.api.signUpEmail({
    body: {
      name: "Staff",
      email: `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
      ...extra,
    },
  });
}

async function userCount(): Promise<number> {
  return (await db.select().from(user)).length;
}

describe("signupMode", () => {
  it("defaults to open when unset or empty", () => {
    expect(signupMode(undefined)).toBe("open");
    expect(signupMode("")).toBe("open");
  });

  it("accepts the three modes", () => {
    expect(signupMode("open")).toBe("open");
    expect(signupMode("first-user")).toBe("first-user");
    expect(signupMode("closed")).toBe("closed");
  });

  it("rejects an unknown value instead of falling back to open", () => {
    expect(() => signupMode("first_user")).toThrow(/open, first-user, closed/);
    expect(() => signupMode("OPEN")).toThrow();
  });
});

describe("SIGNUP=open", () => {
  it("lets any number of accounts sign up", async () => {
    await signUp();
    await signUp();
    expect(await userCount()).toBe(2);
  });

  it("ignores a client that tries to claim the first-user slot", async () => {
    await signUp({ firstSignup: true });
    await signUp({ firstSignup: true });
    expect(await userCount()).toBe(2);
  });
});

describe("SIGNUP=closed", () => {
  beforeEach(() => {
    process.env.SIGNUP = "closed";
  });

  it("refuses sign-up and creates no account", async () => {
    await expect(signUp()).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { code: "SIGNUP_CLOSED" },
    });
    expect(await userCount()).toBe(0);
  });

  it("answers 403 SIGNUP_CLOSED over HTTP", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: "Intruder",
        email: "intruder@example.com",
        password: "password123",
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("SIGNUP_CLOSED");
    expect(await userCount()).toBe(0);
  });
});

describe("SIGNUP=first-user", () => {
  beforeEach(() => {
    process.env.SIGNUP = "first-user";
  });

  it("lets the first account in and refuses the second", async () => {
    await signUp();
    await expect(signUp()).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { code: "SIGNUP_CLOSED" },
    });
    expect(await userCount()).toBe(1);
  });

  it("stays closed to sign-in users after the first account exists over HTTP", async () => {
    await signUp();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: "Second",
        email: "second@example.com",
        password: "password123",
      }),
    });
    expect(res.status).toBe(403);
    expect(await userCount()).toBe(1);
  });

  it("is already closed on an instance upgraded with accounts", async () => {
    const now = new Date();
    await db.insert(user).values({
      id: "legacy",
      name: "Legacy",
      email: "legacy@example.com",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await expect(signUp()).rejects.toMatchObject({
      body: { code: "SIGNUP_CLOSED" },
    });
    expect(await userCount()).toBe(1);
  });

  it("yields exactly one account when sign-ups race", async () => {
    for (let round = 0; round < 10; round++) {
      await db.execute(sql`DELETE FROM "user"`);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => signUp()),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await userCount()).toBe(1);
    }
  });

  it("makes the database refuse a second first-signup row", async () => {
    const now = new Date();
    const row = (id: string) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
      firstSignup: true,
    });
    await db.insert(user).values(row("a"));
    await expect(db.insert(user).values(row("b"))).rejects.toThrow();
    expect(await userCount()).toBe(1);
  });

  it("does not let a client set the slot to pass the check", async () => {
    await signUp();
    await expect(signUp({ firstSignup: false })).rejects.toMatchObject({
      body: { code: "SIGNUP_CLOSED" },
    });
    expect(await userCount()).toBe(1);
  });

  it("can be claimed again after the only account is removed", async () => {
    await signUp();
    await db.execute(sql`DELETE FROM "user"`);
    await signUp();
    expect(await userCount()).toBe(1);
  });
});
