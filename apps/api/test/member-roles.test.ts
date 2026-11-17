import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { membershipAudit, user, venueMemberships } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership, type Role } from "../src/lib/memberships";
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

interface Account {
  id: string;
  cookie: string;
}

let n = 0;
async function signUp(): Promise<Account> {
  n += 1;
  const res = await auth.api.signUpEmail({
    body: {
      name: "Staff",
      email: `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
    },
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return { id: body.user.id, cookie };
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

type Who = Account | { apikey: string } | null;

function call(who: Who, method: string, path: string, body?: unknown) {
  const credentials =
    who === null ? {} : "cookie" in who ? { Cookie: who.cookie } : { apikey: who.apikey };
  return app.request(path, {
    method,
    headers: { ...credentials, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const setRole = (who: Who, venueId: string, userId: string, role: unknown) =>
  call(who, "PATCH", `/v1/venues/${venueId}/members/${userId}`, { role });

const transfer = (who: Who, userId: unknown) =>
  call(who, "POST", "/v1/account/transfer-creator", { userId });

async function rolesOf(venueId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(venueMemberships)
    .where(eq(venueMemberships.venueId, venueId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

const adminCount = async (venueId: string) =>
  Object.values(await rolesOf(venueId)).filter((r) => r === "admin").length;

const auditOf = (venueId: string, action: string) =>
  db
    .select()
    .from(membershipAudit)
    .where(and(eq(membershipAudit.venueId, venueId), eq(membershipAudit.action, action)))
    .orderBy(asc(membershipAudit.id));

const KEY = "key-admin-0123456789abcdef0123";

describe("role change", () => {
  it("promotes and demotes a member, and the new role applies on the next request", async () => {
    const admin = await adminOf("v1");
    const member = await memberOf("v1", "read");

    const up = await setRole(admin, "v1", member.id, "admin");
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ member: { userId: member.id, role: "admin" } });
    expect((await call(member, "GET", "/v1/venues/v1/members")).status).toBe(200);

    const down = await setRole(admin, "v1", member.id, "read");
    expect(down.status).toBe(200);
    expect((await rolesOf("v1"))[member.id]).toBe("read");
    expect((await call(member, "GET", "/v1/venues/v1/members")).status).toBe(403);
  });

  it("writes one role_changed row with the new role, and none for a no-op", async () => {
    const admin = await adminOf("v1");
    const member = await memberOf("v1", "read");

    expect((await setRole(admin, "v1", member.id, "write")).status).toBe(200);
    const again = await setRole(admin, "v1", member.id, "write");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ member: { userId: member.id, role: "write" } });

    const rows = await auditOf("v1", "role_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: admin.id,
      targetUserId: member.id,
      role: "write",
      invitationId: null,
    });
  });

  it("refuses an invalid role and a missing body", async () => {
    const admin = await adminOf("v1");
    const member = await memberOf("v1", "read");
    for (const role of ["owner", "", 1, undefined]) {
      const res = await setRole(admin, "v1", member.id, role);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect((await rolesOf("v1"))[member.id]).toBe("read");
  });

  it("does not let a non-admin session or any key change a role", async () => {
    await adminOf("v1");
    const writer = await memberOf("v1", "write");
    const member = await memberOf("v1", "read");
    await addKey(db, KEY, "agent", ["v1"], "admin");

    for (const who of [writer, { apikey: KEY }]) {
      const res = await setRole(who, "v1", member.id, "admin");
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
    }
    expect((await setRole(null, "v1", member.id, "admin")).status).toBe(401);
    expect((await rolesOf("v1"))[member.id]).toBe("read");
    expect(await auditOf("v1", "role_changed")).toHaveLength(0);
  });

  it("is isolated per venue", async () => {
    const admin = await adminOf("v1");
    const otherAdmin = await adminOf("v2");
    const inV2 = await memberOf("v2", "read");
    const inV1 = await memberOf("v1", "read");

    const outsider = await setRole(otherAdmin, "v1", inV1.id, "admin");
    expect(outsider.status).toBe(404);
    expect((await outsider.json()).code).toBe("venue_not_found");

    const foreign = await setRole(admin, "v1", inV2.id, "admin");
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe("member_not_found");
    expect((await rolesOf("v2"))[inV2.id]).toBe("read");

    const unknown = await setRole(admin, "v1", "nobody", "admin");
    expect((await unknown.json()).code).toBe("member_not_found");
  });

  it("never leaves a venue without an admin", async () => {
    const admin = await adminOf("v1");
    await memberOf("v1", "write");

    const res = await setRole(admin, "v1", admin.id, "read");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect((await rolesOf("v1"))[admin.id]).toBe("admin");
    expect(await auditOf("v1", "role_changed")).toHaveLength(0);
  });

  it("lets an admin demote themselves when another admin remains", async () => {
    const admin = await adminOf("v1");
    const second = await memberOf("v1", "admin");
    expect((await setRole(admin, "v1", admin.id, "write")).status).toBe(200);
    expect((await rolesOf("v1"))[admin.id]).toBe("write");
    expect((await setRole(admin, "v1", second.id, "read")).status).toBe(403);
  });

  it("keeps one admin when two admins demote each other at once", async () => {
    const a = await adminOf("v1");
    const b = await memberOf("v1", "admin");
    const [ra, rb] = await Promise.all([
      setRole(a, "v1", b.id, "read"),
      setRole(b, "v1", a.id, "read"),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 404, 409]).toContain(statuses[1]);
    expect(await adminCount("v1")).toBe(1);
    expect(await auditOf("v1", "role_changed")).toHaveLength(1);
  });

  it("keeps an admin when three admins demote each other in a ring", async () => {
    const a = await adminOf("v1");
    const b = await memberOf("v1", "admin");
    const c = await memberOf("v1", "admin");
    await Promise.all([
      setRole(a, "v1", b.id, "write"),
      setRole(b, "v1", c.id, "write"),
      setRole(c, "v1", a.id, "write"),
    ]);
    expect(await adminCount("v1")).toBeGreaterThanOrEqual(1);
  });
});

describe("creator transfer", () => {
  async function owner(): Promise<Account> {
    process.env.SIGNUP = "first-user";
    const account = await signUp();
    delete process.env.SIGNUP;
    return account;
  }

  async function creators(): Promise<string[]> {
    const rows = await db.select().from(user).where(eq(user.firstSignup, true));
    return rows.map((r) => r.id);
  }

  it("moves the owner mark to a member of a venue the owner administers", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const target = await memberOf("v1", "read");

    const res = await transfer(o, target.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ creator: { userId: target.id } });
    expect(await creators()).toEqual([target.id]);

    process.env.SIGNUP = "first-user";
    expect((await call(o, "POST", "/v1/venues", { name: "x" })).status).toBe(403);
    expect((await call(target, "POST", "/v1/venues", { name: "x" })).status).toBe(201);

    const rows = await auditOf("v1", "creator_transferred");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: o.id, targetUserId: target.id, role: null });
  });

  it("reports the caller's creator status", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const other = await memberOf("v1", "admin");
    const mine = await call(o, "GET", "/v1/account");
    expect(await mine.json()).toEqual({ account: { userId: o.id, isCreator: true } });
    const theirs = await call(other, "GET", "/v1/account");
    expect((await theirs.json()).account.isCreator).toBe(false);
    expect((await call(null, "GET", "/v1/account")).status).toBe(401);
  });

  it("is a no-op when the owner names themselves", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const res = await transfer(o, o.id);
    expect(res.status).toBe(200);
    expect(await creators()).toEqual([o.id]);
    expect(await auditOf("v1", "creator_transferred")).toHaveLength(0);
  });

  it("refuses a caller who is not the owner, even a venue admin", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const admin = await memberOf("v1", "admin");
    const reader = await memberOf("v1", "read");
    const res = await transfer(admin, reader.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
    expect(await creators()).toEqual([o.id]);
  });

  it("refuses a key and a missing session", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const target = await memberOf("v1", "read");
    await addKey(db, KEY, "agent", ["v1"], "admin");
    expect((await transfer({ apikey: KEY }, target.id)).status).toBe(403);
    expect((await transfer(null, target.id)).status).toBe(401);
    expect(await creators()).toEqual([o.id]);
  });

  it("refuses a target that shares no venue the owner administers", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const stranger = await signUp();
    const elsewhere = await adminOf("v2");
    for (const userId of [stranger.id, elsewhere.id, "nobody"]) {
      const res = await transfer(o, userId);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("member_not_found");
    }
    expect(await creators()).toEqual([o.id]);
  });

  it("refuses a target who shares only a venue where the owner is not admin", async () => {
    const o = await owner();
    const other = await adminOf("v2");
    await addMembership(db, o.id, "v2", "write");
    const res = await transfer(o, other.id);
    expect(res.status).toBe(404);
    expect(await creators()).toEqual([o.id]);
  });

  it("rejects a malformed body", async () => {
    const o = await owner();
    for (const userId of [undefined, "", 1]) {
      expect((await transfer(o, userId)).status).toBe(400);
    }
  });

  it("leaves exactly one owner when the owner transfers to two accounts at once", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const a = await memberOf("v1", "read");
    const b = await memberOf("v1", "write");
    const results = await Promise.all([transfer(o, a.id), transfer(o, b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const owners = await creators();
    expect(owners).toHaveLength(1);
    expect([a.id, b.id]).toContain(owners[0]);
  });

  it("rolls back the swap when the audit write fails", async () => {
    const o = await owner();
    await createVenue(db, o.id, { id: "v1", name: "v1" });
    const target = await memberOf("v1", "read");
    await db.execute(
      sql`ALTER TABLE membership_audit ADD CONSTRAINT zz_block CHECK (action <> 'creator_transferred') NOT VALID`,
    );
    try {
      const res = await transfer(o, target.id);
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.execute(sql`ALTER TABLE membership_audit DROP CONSTRAINT zz_block`);
    }
    expect(await creators()).toEqual([o.id]);
  });
});
