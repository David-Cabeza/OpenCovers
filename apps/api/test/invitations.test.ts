import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { invitations, user, venueMemberships, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership, getMembership, type Role } from "../src/lib/memberships";
import { runRetention } from "../src/lib/retention";
import { createVenue } from "../src/lib/venue";

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  delete process.env.SIGNUP;
  await db.execute(
    sql`TRUNCATE TABLE invitations, account, session, verification, "user", venue_memberships, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  delete process.env.SIGNUP;
});

let n = 0;
interface Account {
  id: string;
  email: string;
  cookie: string;
}

async function signUp(headers?: Record<string, string>): Promise<Account> {
  n += 1;
  const email = `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email, password: "password123" },
    headers: new Headers(headers),
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error("sign-up refused"), {
      status: res.status === 403 ? "FORBIDDEN" : String(res.status),
      body,
    });
  }
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return { id: body.user.id, email, cookie };
}

async function adminOf(venueId: string): Promise<Account> {
  const account = await signUp();
  await createVenue(db, account.id, { id: venueId, name: venueId });
  return account;
}

async function memberOf(venueId: string, role: Role): Promise<Account> {
  const account = await signUp();
  await addMembership(db, account.id, venueId, role);
  return account;
}

function call(
  who: Account | { apikey: string } | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const credentials =
    who === null ? {} : "cookie" in who ? { Cookie: who.cookie } : { apikey: who.apikey };
  return app.request(path, {
    method,
    headers: { ...credentials, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function invite(
  admin: Account,
  venueId: string,
  body: Record<string, unknown> = { role: "read" },
) {
  const res = await call(admin, "POST", `/v1/venues/${venueId}/invitations`, body);
  expect(res.status).toBe(201);
  return (await res.json()).invitation as { id: string; token: string } & Record<string, unknown>;
}

function redeem(who: Account | null, token: string) {
  return call(who, "POST", "/v1/invitations/redeem", { token });
}

async function accountCount(): Promise<number> {
  return (await db.select().from(user)).length;
}

async function membershipCount(venueId: string): Promise<number> {
  return (await db.select().from(venueMemberships).where(eq(venueMemberships.venueId, venueId)))
    .length;
}

describe("create", () => {
  it("returns the token once, with the invitation", async () => {
    const admin = await adminOf("v1");
    const before = Date.now();
    const res = await call(admin, "POST", "/v1/venues/v1/invitations", {
      role: "write",
      email: "Maria@Example.com",
    });
    expect(res.status).toBe(201);
    const { invitation } = await res.json();
    expect(invitation).toMatchObject({
      role: "write",
      email: "maria@example.com",
      status: "pending",
    });
    expect(typeof invitation.id).toBe("string");
    expect(invitation.token).toMatch(new RegExp(`^${invitation.id}\\.[A-Za-z0-9_-]{43}$`));
    const hours = (Date.parse(invitation.expiresAt) - before) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
  });

  it("stores only a hash of the secret", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    const secret = created.token.split(".")[1];
    const rows = await db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(secret);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(secret).digest("hex"));
  });

  it("makes an open link when no email is given", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "read" });
    expect(created.email).toBeNull();
  });

  it("accepts a custom expiry within bounds", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "read", expiresInHours: 1 });
    expect((Date.parse(created.expiresAt as string) - Date.now()) / 3_600_000).toBeLessThan(1.1);
  });

  it.each([
    [{ role: "owner" }],
    [{ role: "ADMIN" }],
    [{}],
    [{ role: "read", email: "not-an-email" }],
    [{ role: "read", email: 5 }],
    [{ role: "read", expiresInHours: 0 }],
    [{ role: "read", expiresInHours: 337 }],
    [{ role: "read", expiresInHours: 1.5 }],
    [{ role: "read", expiresInHours: "72" }],
  ])("refuses %j with invalid_request", async (body) => {
    const admin = await adminOf("v1");
    const res = await call(admin, "POST", "/v1/venues/v1/invitations", body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(await db.select().from(invitations)).toHaveLength(0);
  });
});

describe("list", () => {
  it("shows each status, newest first, and never the token or its hash", async () => {
    const admin = await adminOf("v1");
    const pending = await invite(admin, "v1");
    const revoked = await invite(admin, "v1");
    const expired = await invite(admin, "v1");
    const used = await invite(admin, "v1");
    await call(admin, "DELETE", `/v1/venues/v1/invitations/${revoked.id}`);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.id));
    const guest = await signUp();
    expect((await redeem(guest, used.token)).status).toBe(200);

    const res = await call(admin, "GET", "/v1/venues/v1/invitations");
    expect(res.status).toBe(200);
    const body = await res.json();
    const status = Object.fromEntries(
      body.invitations.map((i: { id: string; status: string }) => [i.id, i.status]),
    );
    expect(status).toEqual({
      [pending.id]: "pending",
      [revoked.id]: "revoked",
      [expired.id]: "expired",
      [used.id]: "redeemed",
    });
    const text = JSON.stringify(body);
    for (const t of [pending, revoked, expired, used]) {
      expect(text).not.toContain(t.token.split(".")[1]);
    }
    expect(text).not.toMatch(/token|hash/i);
    const created = body.invitations.map((i: { createdAt: string }) => i.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });
});

describe("revoke", () => {
  it("makes the token useless and is idempotent", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    const first = await call(admin, "DELETE", `/v1/venues/v1/invitations/${created.id}`);
    expect(first.status).toBe(200);
    expect((await first.json()).invitation.status).toBe("revoked");
    const again = await call(admin, "DELETE", `/v1/venues/v1/invitations/${created.id}`);
    expect(again.status).toBe(200);
    const guest = await signUp();
    const res = await redeem(guest, created.token);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_invitation");
    expect(await getMembership(db, guest.id, "v1")).toBeNull();
  });

  it("refuses to revoke a redeemed invitation and keeps the membership", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    const guest = await signUp();
    expect((await redeem(guest, created.token)).status).toBe(200);
    const res = await call(admin, "DELETE", `/v1/venues/v1/invitations/${created.id}`);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("invitation_redeemed");
    expect((await getMembership(db, guest.id, "v1"))?.role).toBe("write");
  });

  it("returns invitation_not_found for an unknown id", async () => {
    const admin = await adminOf("v1");
    const res = await call(admin, "DELETE", "/v1/venues/v1/invitations/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("invitation_not_found");
  });

  it("refuses a revoke that races a redemption, never both", async () => {
    const admin = await adminOf("v1");
    for (let round = 0; round < 6; round++) {
      const created = await invite(admin, "v1");
      const guest = await signUp();
      const [redeemed, revoked] = await Promise.all([
        redeem(guest, created.token),
        call(admin, "DELETE", `/v1/venues/v1/invitations/${created.id}`),
      ]);
      const row = (await db.select().from(invitations).where(eq(invitations.id, created.id)))[0];
      expect(row.redeemedAt !== null && row.revokedAt !== null).toBe(false);
      const member = (await getMembership(db, guest.id, "v1")) !== null;
      expect(member).toBe(redeemed.status === 200);
      expect(member).toBe(row.redeemedAt !== null);
      if (member) expect(revoked.status).toBe(409);
    }
  });

  it("the database refuses a row that is both redeemed and revoked", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    await expect(
      db
        .update(invitations)
        .set({ redeemedAt: new Date(), revokedAt: new Date() })
        .where(eq(invitations.id, created.id)),
    ).rejects.toThrow();
  });
});

describe("redeem for an existing account", () => {
  it("grants the invited role and works once", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    const guest = await signUp();
    const res = await redeem(guest, created.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ membership: { venueId: "v1", role: "write" } });
    expect(await getMembership(db, guest.id, "v1")).toEqual({ venueId: "v1", role: "write" });

    const agenda = await call(guest, "GET", "/v1/venues/v1/agenda?date=2027-03-10");
    expect(agenda.status).toBe(200);
    const keys = await call(guest, "GET", "/v1/venues/v1/keys");
    expect(keys.status).toBe(403);

    const other = await signUp();
    const reuse = await redeem(other, created.token);
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).code).toBe("invalid_invitation");
    expect(await getMembership(db, other.id, "v1")).toBeNull();
    const row = (await db.select().from(invitations))[0];
    expect(row.redeemedBy).toBe(guest.id);
  });

  it("never lowers an existing role and raises a lower one", async () => {
    const admin = await adminOf("v1");
    const down = await invite(admin, "v1", { role: "read" });
    expect((await redeem(admin, down.token)).status).toBe(200);
    expect((await getMembership(db, admin.id, "v1"))?.role).toBe("admin");

    const reader = await memberOf("v1", "read");
    const up = await invite(admin, "v1", { role: "write" });
    expect((await redeem(reader, up.token)).status).toBe(200);
    expect((await getMembership(db, reader.id, "v1"))?.role).toBe("write");
  });

  it("needs a session", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    expect((await redeem(null, created.token)).status).toBe(401);
    await addKey(db, "k-admin", "robot", ["v1"], "admin");
    const withKey = await call({ apikey: "k-admin" }, "POST", "/v1/invitations/redeem", {
      token: created.token,
    });
    expect(withKey.status).toBe(401);
    expect((await db.select().from(invitations))[0].redeemedAt).toBeNull();
  });

  it.each([[{}], [{ token: 5 }], [{ token: "" }]])("refuses the body %j", async (body) => {
    const guest = await signUp();
    const res = await call(guest, "POST", "/v1/invitations/redeem", body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("refuses an expired invitation", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, created.id));
    const guest = await signUp();
    const res = await redeem(guest, created.token);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_invitation");
    expect(await getMembership(db, guest.id, "v1")).toBeNull();
  });

  it("refuses a token with the wrong secret and does not use up the invitation", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    const guest = await signUp();
    const forged = `${created.id}.${"A".repeat(43)}`;
    expect((await redeem(guest, forged)).status).toBe(400);
    expect((await redeem(guest, created.id)).status).toBe(400);
    expect((await db.select().from(invitations))[0].redeemedAt).toBeNull();
    expect((await redeem(guest, created.token)).status).toBe(200);
  });

  it("holds an email-bound invitation for that address, case-insensitively", async () => {
    const admin = await adminOf("v1");
    const intruder = await signUp();
    const target = await signUp();
    const created = await invite(admin, "v1", {
      role: "write",
      email: target.email.toUpperCase(),
    });
    const refused = await redeem(intruder, created.token);
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("invalid_invitation");
    expect(await getMembership(db, intruder.id, "v1")).toBeNull();
    expect((await redeem(target, created.token)).status).toBe(200);
  });

  it("lets anyone with an open link redeem it, once", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    const a = await signUp();
    const b = await signUp();
    expect((await redeem(a, created.token)).status).toBe(200);
    expect((await redeem(b, created.token)).status).toBe(400);
  });

  it("gives 8 concurrent redemptions of one token exactly one membership", async () => {
    const admin = await adminOf("v1");
    for (let round = 0; round < 5; round++) {
      const created = await invite(admin, "v1", { role: "write" });
      const guests = await Promise.all(Array.from({ length: 8 }, () => signUp()));
      const before = await membershipCount("v1");
      const results = await Promise.all(guests.map((g) => redeem(g, created.token)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(7);
      expect(await membershipCount("v1")).toBe(before + 1);
    }
  });
});

describe("redeem by signing up", () => {
  const TOKEN_HEADER = "x-invitation-token";

  it("works with SIGNUP=closed, once, and creates no venue", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    process.env.SIGNUP = "closed";
    const venuesBefore = (await db.select().from(venues)).length;

    const guest = await signUp({ [TOKEN_HEADER]: created.token });
    expect(await getMembership(db, guest.id, "v1")).toEqual({ venueId: "v1", role: "write" });
    expect(await db.select().from(venueMemberships).where(eq(venueMemberships.userId, guest.id)))
      .toHaveLength(1);
    expect((await db.select().from(venues)).length).toBe(venuesBefore);
    const row = (await db.select().from(user).where(eq(user.id, guest.id)))[0];
    expect(row.firstSignup).toBe(false);
    const stored = (await db.select().from(invitations))[0];
    expect(stored.redeemedBy).toBe(guest.id);

    const list = await call(guest, "GET", "/v1/venues");
    expect((await list.json()).venues).toHaveLength(1);
  });

  it("still refuses sign-up without an invitation when closed", async () => {
    await adminOf("v1");
    process.env.SIGNUP = "closed";
    const count = await accountCount();
    await expect(signUp()).rejects.toMatchObject({ body: { code: "SIGNUP_CLOSED" } });
    expect(await accountCount()).toBe(count);
  });

  it("works with SIGNUP=first-user after the first account exists, without becoming the first user", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    process.env.SIGNUP = "first-user";
    await expect(signUp()).rejects.toMatchObject({ body: { code: "SIGNUP_CLOSED" } });
    const guest = await signUp({ [TOKEN_HEADER]: created.token });
    expect((await getMembership(db, guest.id, "v1"))?.role).toBe("read");
    const row = (await db.select().from(user).where(eq(user.id, guest.id)))[0];
    expect(row.firstSignup).toBe(false);
  });

  it("works with SIGNUP=open and over the HTTP route", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "admin" });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        [TOKEN_HEADER]: created.token,
      },
      body: JSON.stringify({ name: "New", email: "new@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const { user: created2 } = await res.json();
    expect((await getMembership(db, created2.id, "v1"))?.role).toBe("admin");
  });

  it.each(["closed", "first-user", "open"])(
    "refuses a bad token in SIGNUP=%s with INVALID_INVITATION",
    async (mode) => {
      const admin = await adminOf("v1");
      process.env.SIGNUP = mode;
      const count = await accountCount();
      const forged = `${(await invite(admin, "v1")).id}.${"B".repeat(43)}`;
      await expect(signUp({ [TOKEN_HEADER]: forged })).rejects.toMatchObject({
        status: "FORBIDDEN",
        body: { code: "INVALID_INVITATION" },
      });
      await expect(signUp({ [TOKEN_HEADER]: "garbage" })).rejects.toMatchObject({
        body: { code: "INVALID_INVITATION" },
      });
      expect(await accountCount()).toBe(count);
    },
  );

  it("refuses an expired, revoked or used invitation and creates no account", async () => {
    const admin = await adminOf("v1");
    process.env.SIGNUP = "closed";
    const expired = await invite(admin, "v1");
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.id));
    const revoked = await invite(admin, "v1");
    await call(admin, "DELETE", `/v1/venues/v1/invitations/${revoked.id}`);
    const used = await invite(admin, "v1");
    await signUp({ [TOKEN_HEADER]: used.token });

    const count = await accountCount();
    for (const t of [expired, revoked, used]) {
      await expect(signUp({ [TOKEN_HEADER]: t.token })).rejects.toMatchObject({
        body: { code: "INVALID_INVITATION" },
      });
    }
    expect(await accountCount()).toBe(count);
  });

  it("holds an email-bound invitation for that address at sign-up", async () => {
    const admin = await adminOf("v1");
    process.env.SIGNUP = "closed";
    const created = await invite(admin, "v1", { role: "read", email: "maria@example.com" });
    const count = await accountCount();
    await expect(signUp({ [TOKEN_HEADER]: created.token })).rejects.toMatchObject({
      body: { code: "INVALID_INVITATION" },
    });
    expect(await accountCount()).toBe(count);
    const res = await auth.api.signUpEmail({
      body: { name: "Maria", email: "Maria@Example.com", password: "password123" },
      headers: new Headers({ [TOKEN_HEADER]: created.token }),
      asResponse: true,
    });
    expect(res.status).toBe(200);
    const { user: maria } = await res.json();
    expect((await getMembership(db, maria.id, "v1"))?.role).toBe("read");
  });

  it("creates one account from 6 concurrent sign-ups with one token", async () => {
    const admin = await adminOf("v1");
    process.env.SIGNUP = "closed";
    for (let round = 0; round < 4; round++) {
      const created = await invite(admin, "v1");
      const count = await accountCount();
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => signUp({ [TOKEN_HEADER]: created.token })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await accountCount()).toBe(count + 1);
      const row = (await db.select().from(invitations).where(eq(invitations.id, created.id)))[0];
      expect(row.redeemedBy).not.toBeNull();
    }
  });
});

describe("who can invite", () => {
  it("refuses a read or write staff session on every route and changes nothing", async () => {
    const admin = await adminOf("v1");
    const existing = await invite(admin, "v1");
    for (const role of ["read", "write"] as const) {
      const staff = await memberOf("v1", role);
      const create = await call(staff, "POST", "/v1/venues/v1/invitations", { role: "read" });
      const list = await call(staff, "GET", "/v1/venues/v1/invitations");
      const revoke = await call(staff, "DELETE", `/v1/venues/v1/invitations/${existing.id}`);
      for (const res of [create, list, revoke]) {
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe("forbidden");
      }
    }
    const rows = await db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it("refuses every API key, including an admin key", async () => {
    const admin = await adminOf("v1");
    const existing = await invite(admin, "v1");
    for (const role of ["read", "write", "admin"] as const) {
      await addKey(db, `key-${role}`, `robot-${role}`, ["v1"], role);
      const who = { apikey: `key-${role}` };
      const create = await call(who, "POST", "/v1/venues/v1/invitations", { role: "read" });
      const list = await call(who, "GET", "/v1/venues/v1/invitations");
      const revoke = await call(who, "DELETE", `/v1/venues/v1/invitations/${existing.id}`);
      for (const res of [create, list, revoke]) expect(res.status).toBe(403);
    }
    const rows = await db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it("refuses a key sent together with an admin session", async () => {
    const admin = await adminOf("v1");
    await addKey(db, "key-w", "robot", ["v1"], "write");
    const res = await app.request("/v1/venues/v1/invitations", {
      method: "POST",
      headers: { Cookie: admin.cookie, apikey: "key-w", "content-type": "application/json" },
      body: JSON.stringify({ role: "read" }),
    });
    expect(res.status).toBe(403);
    expect(await db.select().from(invitations)).toHaveLength(0);
  });

  it("answers 401 without credentials", async () => {
    await adminOf("v1");
    expect((await call(null, "POST", "/v1/venues/v1/invitations", { role: "read" })).status).toBe(
      401,
    );
    expect((await call(null, "GET", "/v1/venues/v1/invitations")).status).toBe(401);
  });

  it("does not let a redeemed read invitation invite anyone", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "read" });
    const guest = await signUp();
    await redeem(guest, created.token);
    const res = await call(guest, "POST", "/v1/venues/v1/invitations", { role: "read" });
    expect(res.status).toBe(403);
  });

  it("lets an invited admin invite in that venue only", async () => {
    const adminA = await adminOf("va");
    await adminOf("vb");
    const created = await invite(adminA, "va", { role: "admin" });
    const guest = await signUp();
    await redeem(guest, created.token);
    const ok = await call(guest, "POST", "/v1/venues/va/invitations", { role: "write" });
    expect(ok.status).toBe(201);
    const other = await call(guest, "POST", "/v1/venues/vb/invitations", { role: "read" });
    expect(other.status).toBe(404);
  });
});

describe("venue isolation", () => {
  it("keeps one venue's invitations out of another's list, revoke and create", async () => {
    const adminA = await adminOf("va");
    const adminB = await adminOf("vb");
    const forA = await invite(adminA, "va", { role: "write", email: "a@example.com" });

    const listB = await (await call(adminB, "GET", "/v1/venues/vb/invitations")).json();
    expect(listB.invitations).toEqual([]);

    const revoke = await call(adminB, "DELETE", `/v1/venues/vb/invitations/${forA.id}`);
    expect(revoke.status).toBe(404);
    expect((await revoke.json()).code).toBe("invitation_not_found");
    expect((await db.select().from(invitations))[0].revokedAt).toBeNull();

    const intoB = await call(adminA, "POST", "/v1/venues/vb/invitations", { role: "read" });
    expect(intoB.status).toBe(404);
    expect((await intoB.json()).code).toBe("venue_not_found");
    expect(await db.select().from(invitations)).toHaveLength(1);
  });

  it("answers every failed redemption identically and names no venue", async () => {
    const adminA = await adminOf("va");
    await adminOf("vb");
    const guest = await signUp();
    const unknown = await redeem(guest, `${crypto.randomUUID()}.${"C".repeat(43)}`);
    const expired = await invite(adminA, "va", { role: "admin" });
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.id));
    const revoked = await invite(adminA, "va");
    await call(adminA, "DELETE", `/v1/venues/va/invitations/${revoked.id}`);
    const wrongEmail = await invite(adminA, "va", { role: "read", email: "someone@example.com" });
    const used = await invite(adminA, "va");
    await redeem(await signUp(), used.token);

    const baseline = { status: unknown.status, body: await unknown.json() };
    expect(baseline.status).toBe(400);
    for (const t of [expired, revoked, wrongEmail, used]) {
      const res = await redeem(guest, t.token);
      expect({ status: res.status, body: await res.json() }).toEqual(baseline);
    }
    expect(JSON.stringify(baseline)).not.toMatch(/"va"|"vb"|venue/);
  });

  it("names only the invited venue on success", async () => {
    const adminA = await adminOf("va");
    await adminOf("vb");
    const created = await invite(adminA, "va");
    const guest = await signUp();
    const text = JSON.stringify(await (await redeem(guest, created.token)).json());
    expect(text).toContain("va");
    expect(text).not.toContain("vb");
    expect(await getMembership(db, guest.id, "vb")).toBeNull();
  });
});

describe("retention and deletion", () => {
  it("deletes invitations more than 30 days past expiry, in any state, and keeps newer ones", async () => {
    const admin = await adminOf("v1");
    const old = await invite(admin, "v1", { role: "read", email: "old@example.com" });
    const used = await invite(admin, "v1");
    const recent = await invite(admin, "v1", { role: "read", email: "recent@example.com" });
    const live = await invite(admin, "v1");
    await redeem(await signUp(), used.token);
    const day = 86_400_000;
    const expireAt = async (id: string, daysAgo: number) => {
      await db
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - daysAgo * day) })
        .where(eq(invitations.id, id));
    };
    await expireAt(old.id, 31);
    await expireAt(used.id, 31);
    await expireAt(recent.id, 29);

    await runRetention(db);
    const ids = (await db.select().from(invitations)).map((r) => r.id).sort();
    expect(ids).toEqual([recent.id, live.id].sort());
  });

  it("keeps the membership after its invitation is deleted", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    const guest = await signUp();
    await redeem(guest, created.token);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(invitations.id, created.id));
    await runRetention(db);
    expect(await db.select().from(invitations)).toHaveLength(0);
    expect((await getMembership(db, guest.id, "v1"))?.role).toBe("write");
  });

  it("removes a venue's invitations with the venue and nulls the user links with the account", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1");
    const guest = await signUp();
    await redeem(guest, created.token);
    await db.delete(user).where(eq(user.id, guest.id));
    await db.delete(user).where(eq(user.id, admin.id));
    const row = (await db.select().from(invitations))[0];
    expect(row.redeemedBy).toBeNull();
    expect(row.invitedBy).toBeNull();
    await db.delete(venues).where(eq(venues.id, "v1"));
    expect(await db.select().from(invitations)).toHaveLength(0);
  });
});
