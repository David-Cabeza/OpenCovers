import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { apiKeys, grants, session, membershipAudit, venueMemberships, webhookEndpoints } from "../src/db/schema";
import { addKey, authenticate } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership, type Role } from "../src/lib/memberships";
import { removeMember } from "../src/lib/members";
import { createVenue } from "../src/lib/venue";
import { createWebhook, listWebhooks } from "../src/lib/webhooks";
import { sha256Hex } from "../src/lib/reservations";

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  delete process.env.SIGNUP;
  await db.execute(
    sql`TRUNCATE TABLE membership_audit, invitations, account, session, verification, "user", venue_memberships, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(async () => {
  delete process.env.SIGNUP;
  await db.execute(sql`DROP TRIGGER IF EXISTS fail_audit ON membership_audit`);
  await db.execute(sql`DROP FUNCTION IF EXISTS fail_audit()`);
});

let n = 0;
interface Account {
  id: string;
  email: string;
  name: string;
  cookie: string;
}
type Who = Account | { apikey: string } | null;

async function signUp(): Promise<Account> {
  n += 1;
  const email = `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email, password: "password123" },
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  return { id: body.user.id, email, name: "Staff", cookie: res.headers.get("set-cookie")! };
}

async function signInAgain(account: Account): Promise<void> {
  const res = await auth.api.signInEmail({
    body: { email: account.email, password: "password123" },
    asResponse: true,
  });
  if (!res.ok) throw new Error("sign-in refused");
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

function call(who: Who, method: string, path: string, body?: unknown) {
  const credentials =
    who === null ? {} : "cookie" in who ? { Cookie: who.cookie } : { apikey: who.apikey };
  return app.request(path, {
    method,
    headers: { ...credentials, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const remove = (who: Who, venueId: string, userId: string) =>
  call(who, "DELETE", `/v1/venues/${venueId}/members/${userId}`);
const audit = (who: Who, venueId: string, query = "") =>
  call(who, "GET", `/v1/venues/${venueId}/audit${query}`);

async function mintKey(who: Account, venueId: string, role: "read" | "write" = "write") {
  const apikey = `k-${Math.random().toString(36).slice(2)}-0123456789abcdefghijklmnop`;
  const res = await call(who, "POST", `/v1/venues/${venueId}/keys`, {
    key: apikey,
    principal: `integration-${apikey.slice(2, 6)}`,
    role,
  });
  expect(res.status).toBe(201);
  return apikey;
}

async function keyFor(venueId: string, role: Role): Promise<{ apikey: string }> {
  const apikey = `key-${role}-${Math.random().toString(36).slice(2)}-0123456789abcdef`;
  await addKey(db, apikey, `agent-${role}`, [venueId], role);
  return { apikey };
}

const policy = {
  allowInsecure: false,
  resolveHost: async () => [{ address: "93.184.216.34", family: 4 as const }],
};

async function hook(venueId: string, url: string, createdBy: string | null) {
  const result = await createWebhook(db, venueId, url, policy, createdBy);
  if (!result.ok) throw new Error(result.code);
  return result.webhook;
}

const sessionCount = async (userId: string) =>
  (await db.select().from(session).where(eq(session.userId, userId))).length;
const auditRows = (venueId: string) =>
  db.select().from(membershipAudit).where(eq(membershipAudit.venueId, venueId)).orderBy(membershipAudit.id);

describe("sessions", () => {
  it("revokes every session when the removal was the last membership", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "write");
    await signInAgain(victim);
    expect(await sessionCount(victim.id)).toBe(2);
    const res = await remove(admin, "v1", victim.id);
    expect(res.status).toBe(200);
    expect((await res.json()).revoked.sessions).toBe(2);
    expect(await sessionCount(victim.id)).toBe(0);
    expect((await call(victim, "GET", "/v1/venues")).status).toBe(401);
    expect(await sessionCount(admin.id)).toBe(1);
  });

  it("keeps the sessions when the person still belongs to another venue", async () => {
    const admin = await adminOf("v1");
    await adminOf("v2");
    const victim = await memberOf("v1", "write");
    await addMembership(db, victim.id, "v2", "read");
    const res = await remove(admin, "v1", victim.id);
    expect((await res.json()).revoked.sessions).toBe(0);
    expect(await sessionCount(victim.id)).toBe(1);
    const venues = await (await call(victim, "GET", "/v1/venues")).json();
    expect(venues.venues.map((v: { id: string }) => v.id)).toEqual(["v2"]);
    expect((await auditRows("v1")).map((r) => r.action)).toEqual(["member_removed"]);
  });
});

describe("keys", () => {
  it("revokes only the keys the removed person made in this venue", async () => {
    const admin = await adminOf("v1");
    const other = await adminOf("v2");
    const victim = await memberOf("v1", "admin");
    await addMembership(db, victim.id, "v2", "admin");
    const victimV1 = await mintKey(victim, "v1");
    const victimV2 = await mintKey(victim, "v2");
    const adminV1 = await mintKey(admin, "v1");
    const otherV2 = await mintKey(other, "v2");
    const legacy = (await keyFor("v1", "write")).apikey;

    // A key of the victim's that spans two venues keeps only the other grant.
    const shared = `shared-${Math.random().toString(36).slice(2)}-0123456789abcdef`;
    await addKey(db, shared, "shared", ["v1", "v2"], "read", victim.id);

    const res = await remove(admin, "v1", victim.id);
    expect((await res.json()).revoked.keys).toBe(2);

    expect((await authenticate(db, victimV1, "v1")).ok).toBe(false);
    expect((await authenticate(db, shared, "v1")).ok).toBe(false);
    expect((await authenticate(db, shared, "v2")).ok).toBe(true);
    expect((await authenticate(db, victimV2, "v2")).ok).toBe(true);
    expect((await authenticate(db, adminV1, "v1")).ok).toBe(true);
    expect((await authenticate(db, otherV2, "v2")).ok).toBe(true);
    expect((await authenticate(db, legacy, "v1")).ok).toBe(true);
    // The fully revoked key row is gone, as with an admin revoking it.
    expect(await db.select().from(apiKeys).where(eq(apiKeys.hash, await sha256Hex(victimV1)))).toHaveLength(0);
  });
});

describe("webhooks", () => {
  it("flags the removed person's endpoints and neither deletes nor disables them", async () => {
    const admin = await adminOf("v1");
    await adminOf("v2");
    const victim = await memberOf("v1", "write");
    const mine = await hook("v1", "https://a.example/hook", victim.id);
    const theirs = await hook("v1", "https://b.example/hook", admin.id);
    const byKey = await hook("v1", "https://c.example/hook", null);
    const elsewhere = await hook("v2", "https://d.example/hook", victim.id);

    const res = await remove(admin, "v1", victim.id);
    expect((await res.json()).revoked.webhooksFlagged).toBe(1);

    const listed = await (await call(admin, "GET", "/v1/venues/v1/webhooks")).json();
    const byId = Object.fromEntries(listed.webhooks.map((w: { id: string }) => [w.id, w]));
    expect(byId[mine.id].creatorDepartedAt).toMatch(/^\d{4}-/);
    expect(byId[mine.id].enabled).toBe(true);
    expect(byId[theirs.id].creatorDepartedAt).toBeNull();
    expect(byId[byKey.id].creatorDepartedAt).toBeNull();
    expect(JSON.stringify(listed)).not.toContain(victim.id);
    const other = (await listWebhooks(db, "v2")).find((w) => w.id === elsewhere.id);
    expect(other?.creatorDepartedAt).toBeNull();
  });

  it("records the creator of an endpoint made by a person, not by a key", async () => {
    const admin = await adminOf("v1");
    const viaKey = await hook("v1", "https://k.example/hook", null);
    const viaSession = await hook("v1", "https://s.example/hook", admin.id);
    const rows = await db.select().from(webhookEndpoints);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.createdBy]));
    expect(by[viaKey.id]).toBeNull();
    expect(by[viaSession.id]).toBe(admin.id);
  });
});

describe("atomicity and the last admin", () => {
  it("rolls everything back when the audit write fails", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "admin");
    const key = await mintKey(victim, "v1");
    await hook("v1", "https://a.example/hook", victim.id);
    await signInAgain(victim);
    await db.execute(sql`
      CREATE FUNCTION fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'member_removed' THEN RAISE EXCEPTION 'audit down'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(
      sql`CREATE TRIGGER fail_audit BEFORE INSERT ON membership_audit FOR EACH ROW EXECUTE FUNCTION fail_audit()`,
    );

    await expect(removeMember(db, "v1", admin.id, victim.id)).rejects.toThrow();

    const members = await db.select().from(venueMemberships).where(eq(venueMemberships.userId, victim.id));
    expect(members).toHaveLength(1);
    expect(await sessionCount(victim.id)).toBe(2);
    expect((await authenticate(db, key, "v1")).ok).toBe(true);
    expect((await listWebhooks(db, "v1"))[0].creatorDepartedAt).toBeNull();
    expect(await auditRows("v1")).toHaveLength(0);
  });

  it("blocks the last admin and revokes nothing", async () => {
    const admin = await adminOf("v1");
    await memberOf("v1", "read");
    const key = await mintKey(admin, "v1");
    await hook("v1", "https://a.example/hook", admin.id);
    await signInAgain(admin);
    const res = await remove(admin, "v1", admin.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect(await sessionCount(admin.id)).toBe(2);
    expect((await authenticate(db, key, "v1")).ok).toBe(true);
    expect((await listWebhooks(db, "v1"))[0].creatorDepartedAt).toBeNull();
    expect(await db.select().from(grants).where(eq(grants.venueId, "v1"))).toHaveLength(1);
    expect(await auditRows("v1")).toHaveLength(0);
  });

  it("writes no audit row for a member that is not found", async () => {
    const admin = await adminOf("v1");
    expect((await remove(admin, "v1", "nobody")).status).toBe(404);
    expect(await auditRows("v1")).toHaveLength(0);
  });
});

describe("audit rows", () => {
  it("writes the removal row with the revocation, and holds no secret", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "admin");
    const apikey = await mintKey(victim, "v1");
    const wh = await hook("v1", "https://a.example/hook", victim.id);
    const { invitation } = await (
      await call(admin, "POST", "/v1/venues/v1/invitations", {
        role: "write",
        email: "bound.person@example.com",
      })
    ).json();
    const [id, secret] = invitation.token.split(".");
    const res = await remove(admin, "v1", victim.id);
    expect((await res.json()).revoked).toEqual({ keys: 1, sessions: 1, webhooksFlagged: 1 });

    const rows = await auditRows("v1");
    expect(rows.map((r) => r.action)).toEqual(["invited", "member_removed"]);
    expect(rows[1]).toMatchObject({ actorUserId: admin.id, targetUserId: victim.id, role: "admin" });

    const everything =
      JSON.stringify(await db.select().from(membershipAudit)) +
      JSON.stringify(await (await audit(admin, "v1")).json());
    for (const forbidden of [
      invitation.token,
      secret,
      "bound.person@example.com",
      admin.email,
      victim.email,
      apikey,
      await sha256Hex(apikey),
      wh.secret,
      "a.example",
    ]) {
      expect(everything).not.toContain(forbidden);
    }
    expect(everything).toContain(id);
  });
});

describe("GET /audit", () => {
  it("is open to an admin session and an admin key, and closed to the rest", async () => {
    const admin = await adminOf("v1");
    await call(admin, "POST", "/v1/venues/v1/invitations", { role: "read" });
    const ok = await audit(admin, "v1");
    expect(ok.status).toBe(200);
    expect((await ok.json()).entries).toHaveLength(1);
    expect((await audit(await keyFor("v1", "admin"), "v1")).status).toBe(200);

    for (const role of ["read", "write"] as const) {
      const staff = await memberOf("v1", role);
      const res = await audit(staff, "v1");
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
      expect((await audit(await keyFor("v1", role), "v1")).status).toBe(403);
    }
    expect((await audit(null, "v1")).status).toBe(401);
  });

  it("treats another venue as not found and never mixes venues", async () => {
    const a = await adminOf("v1");
    const b = await adminOf("v2");
    await call(a, "POST", "/v1/venues/v1/invitations", { role: "read" });
    await call(b, "POST", "/v1/venues/v2/invitations", { role: "write" });
    const res = await audit(b, "v1");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("venue_not_found");
    const key = await keyFor("v2", "admin");
    expect((await audit(key, "v1")).status).toBe(404);
    const mine = (await (await audit(a, "v1")).json()).entries;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ action: "invited", actorUserId: a.id });
    expect(JSON.stringify(mine)).not.toContain(b.id);
  });

  it("pages newest first with a cursor and a limit", async () => {
    const admin = await adminOf("v1");
    for (let i = 0; i < 5; i += 1) {
      await call(admin, "POST", "/v1/venues/v1/invitations", { role: "read" });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await (await audit(admin, "v1", q)).json();
      expect(body.entries.length).toBeLessThanOrEqual(2);
      seen.push(...body.entries.map((e: { id: string }) => e.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen.map(Number)).toEqual([...seen.map(Number)].sort((x, y) => y - x));

    const exact = await (await audit(admin, "v1", "?limit=5")).json();
    expect(exact.nextCursor).toBeNull();
  });

  it("rejects a bad limit, a malformed cursor, and a cursor from another venue", async () => {
    const a = await adminOf("v1");
    const b = await adminOf("v2");
    for (let i = 0; i < 3; i += 1) {
      await call(b, "POST", "/v1/venues/v2/invitations", { role: "read" });
    }
    const foreign = (await (await audit(b, "v2", "?limit=1")).json()).nextCursor as string;
    expect(foreign).toBeTruthy();
    for (const q of ["?limit=0", "?limit=201", "?limit=x", "?cursor=junk", `?cursor=${encodeURIComponent(foreign)}`]) {
      const res = await audit(a, "v1", q);
      expect(res.status, q).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
  });
});
