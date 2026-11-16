import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { invitations, user, venueMemberships } from "../src/db/schema";
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

let n = 0;
interface Account {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

async function signUp(name = "Staff"): Promise<Account> {
  n += 1;
  const email = `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await auth.api.signUpEmail({
    body: { name, email, password: "password123" },
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return { id: body.user.id, email, name, cookie };
}

// Removal that leaves no membership revokes the account's sessions (ADR-0010),
// so the person signs in again to get a working cookie.
async function signInAgain(account: Account): Promise<Account> {
  const res = await auth.api.signInEmail({
    body: { email: account.email, password: "password123" },
    asResponse: true,
  });
  const cookie = res.headers.get("set-cookie");
  if (!res.ok || !cookie) throw new Error("sign-in refused");
  return { ...account, cookie };
}

async function adminOf(venueId: string, name?: string): Promise<Account> {
  const account = await signUp(name);
  await createVenue(db, account.id, { id: venueId, name: venueId });
  return account;
}

async function memberOf(venueId: string, role: Role, name?: string): Promise<Account> {
  const account = await signUp(name);
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

const list = (who: Account | { apikey: string } | null, venueId: string) =>
  call(who, "GET", `/v1/venues/${venueId}/members`);
const remove = (who: Account | { apikey: string } | null, venueId: string, userId: string) =>
  call(who, "DELETE", `/v1/venues/${venueId}/members/${userId}`);

async function rolesOf(venueId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(venueMemberships)
    .where(eq(venueMemberships.venueId, venueId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

async function adminCount(venueId: string): Promise<number> {
  return Object.values(await rolesOf(venueId)).filter((r) => r === "admin").length;
}

async function keyFor(venueId: string, role: Role): Promise<{ apikey: string }> {
  const apikey = `key-${role}-${Math.random().toString(36).slice(2)}-0123456789abcdef`;
  await addKey(db, apikey, `agent-${role}`, [venueId], role);
  return { apikey };
}

describe("list", () => {
  it("shows each member with name, email and role, ordered by email", async () => {
    const admin = await adminOf("v1", "Ana Admin");
    const writer = await memberOf("v1", "write", "Wen Writer");
    const reader = await memberOf("v1", "read", "Rae Reader");
    const res = await list(admin, "v1");
    expect(res.status).toBe(200);
    const { members } = await res.json();
    const expected = [admin, writer, reader]
      .map((a, i) => ({
        userId: a.id,
        name: a.name,
        email: a.email,
        role: (["admin", "write", "read"] as const)[i],
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
    expect(members).toEqual(expected);
  });

  it("returns nothing beyond the four fields", async () => {
    const admin = await adminOf("v1");
    const { members } = await (await list(admin, "v1")).json();
    expect(Object.keys(members[0]).sort()).toEqual(["email", "name", "role", "userId"]);
  });

  it("shows only the venue's own members", async () => {
    const a = await adminOf("v1");
    const b = await adminOf("v2");
    const { members } = await (await list(a, "v1")).json();
    expect(members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
    expect(JSON.stringify(members)).not.toContain(b.email);
  });

  it("treats a venue the caller does not belong to as not found", async () => {
    await adminOf("v1");
    const outsider = await adminOf("v2");
    const res = await list(outsider, "v1");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("venue_not_found");
  });

  it("needs credentials", async () => {
    await adminOf("v1");
    expect((await list(null, "v1")).status).toBe(401);
  });
});

describe("roles", () => {
  it("refuses read and write sessions on list and remove, and changes nothing", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "read");
    for (const role of ["read", "write"] as const) {
      const staff = await memberOf("v1", role);
      const listed = await list(staff, "v1");
      expect(listed.status).toBe(403);
      expect((await listed.json()).code).toBe("forbidden");
      const removed = await remove(staff, "v1", victim.id);
      expect(removed.status).toBe(403);
      expect((await removed.json()).code).toBe("forbidden");
    }
    expect((await rolesOf("v1"))[victim.id]).toBe("read");
    expect((await rolesOf("v1"))[admin.id]).toBe("admin");
  });

  it("refuses a key of every role, an admin key included", async () => {
    await adminOf("v1");
    const victim = await memberOf("v1", "write");
    for (const role of ["read", "write", "admin"] as const) {
      const key = await keyFor("v1", role);
      const listed = await list(key, "v1");
      expect(listed.status).toBe(403);
      expect((await listed.json()).code).toBe("forbidden");
      const removed = await remove(key, "v1", victim.id);
      expect(removed.status).toBe(403);
      expect((await removed.json()).code).toBe("forbidden");
    }
    expect((await rolesOf("v1"))[victim.id]).toBe("write");
  });

  it("refuses a key that is not granted the venue as not found", async () => {
    await adminOf("v1");
    await adminOf("v2");
    const key = await keyFor("v2", "admin");
    expect((await list(key, "v1")).status).toBe(404);
  });
});

describe("remove", () => {
  it("removes a member and returns the membership that went", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "write");
    const res = await remove(admin, "v1", victim.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      member: { userId: victim.id, role: "write" },
      revoked: { keys: 0, sessions: 1, webhooksFlagged: 0 },
    });
    const { members } = await (await list(admin, "v1")).json();
    expect(members.map((m: { userId: string }) => m.userId)).toEqual([admin.id]);
  });

  it("ends the person's access to that venue on their next request", async () => {
    const admin = await adminOf("v1");
    await adminOf("v2");
    const victim = await memberOf("v1", "write");
    await addMembership(db, victim.id, "v2", "read");
    const date = "2026-11-12";
    expect((await call(victim, "GET", `/v1/venues/v1/agenda?date=${date}`)).status).toBe(200);
    expect((await remove(admin, "v1", victim.id)).status).toBe(200);

    const read = await call(victim, "GET", `/v1/venues/v1/agenda?date=${date}`);
    expect(read.status).toBe(404);
    expect((await read.json()).code).toBe("venue_not_found");
    const write = await call(victim, "PUT", "/v1/venues/v1/config", {
      enabled: true,
      noticeAddress: "x@example.com",
    });
    expect(write.status).toBe(404);
    expect((await write.json()).code).toBe("venue_not_found");
  });

  it("leaves the account and the person's other venues alone", async () => {
    const admin = await adminOf("v1");
    const other = await adminOf("v2");
    const victim = await memberOf("v1", "read");
    await addMembership(db, victim.id, "v2", "write");
    expect((await remove(admin, "v1", victim.id)).status).toBe(200);
    expect(await db.select().from(user).where(eq(user.id, victim.id))).toHaveLength(1);
    const venues = await (await call(victim, "GET", "/v1/venues")).json();
    expect(venues.venues.map((v: { id: string }) => v.id)).toEqual(["v2"]);
    expect((await rolesOf("v2"))[victim.id]).toBe("write");
    expect((await rolesOf("v2"))[other.id]).toBe("admin");
  });

  it("keeps an account with no membership left, but its sessions end (ADR-0010)", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "read");
    await remove(admin, "v1", victim.id);
    expect(await db.select().from(user).where(eq(user.id, victim.id))).toHaveLength(1);
    const res = await call(victim, "GET", "/v1/venues");
    expect(res.status).toBe(401);
  });

  it("does not revoke API keys, which belong to integrations", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "write");
    const key = await keyFor("v1", "write");
    await remove(admin, "v1", victim.id);
    expect((await call(key, "GET", "/v1/venues/v1/agenda?date=2026-11-12")).status).toBe(200);
  });

  it("answers not found for an unknown user", async () => {
    const admin = await adminOf("v1");
    const res = await remove(admin, "v1", "nobody");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("member_not_found");
  });

  it("answers not found, and changes nothing, for a member of another venue", async () => {
    const admin = await adminOf("v1");
    const foreign = await adminOf("v2");
    const res = await remove(admin, "v1", foreign.id);
    expect(res.status).toBe(404);
    const foreignBody = await res.json();
    expect(foreignBody.code).toBe("member_not_found");
    expect((await rolesOf("v2"))[foreign.id]).toBe("admin");
    const unknown = await remove(admin, "v1", "nobody");
    expect(await unknown.json()).toEqual(foreignBody);
  });

  it("is not repeatable: the second removal is not found", async () => {
    const admin = await adminOf("v1");
    const victim = await memberOf("v1", "read");
    expect((await remove(admin, "v1", victim.id)).status).toBe(200);
    expect((await remove(admin, "v1", victim.id)).status).toBe(404);
  });

  it("lets an admin leave when another admin remains", async () => {
    const first = await adminOf("v1");
    const second = await memberOf("v1", "admin");
    expect((await remove(first, "v1", first.id)).status).toBe(200);
    expect(await rolesOf("v1")).toEqual({ [second.id]: "admin" });
  });

  it("leaves the invitation that created the membership redeemed", async () => {
    const admin = await adminOf("v1");
    const created = await call(admin, "POST", "/v1/venues/v1/invitations", { role: "read" });
    const token = (await created.json()).invitation.token as string;
    const guest = await signUp();
    expect((await call(guest, "POST", "/v1/invitations/redeem", { token })).status).toBe(200);
    expect((await remove(admin, "v1", guest.id)).status).toBe(200);
    const rows = await db.select().from(invitations).where(eq(invitations.venueId, "v1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].redeemedBy).toBe(guest.id);
    const again = await call(await signInAgain(guest), "POST", "/v1/invitations/redeem", { token });
    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe("invalid_invitation");
    expect((await rolesOf("v1"))[guest.id]).toBeUndefined();
  });

  it("lets a removed person be invited again", async () => {
    const admin = await adminOf("v1");
    const person = await memberOf("v1", "admin");
    expect((await remove(admin, "v1", person.id)).status).toBe(200);
    const created = await call(admin, "POST", "/v1/venues/v1/invitations", { role: "write" });
    const token = (await created.json()).invitation.token as string;
    const back = await signInAgain(person);
    const redeemed = await call(back, "POST", "/v1/invitations/redeem", { token });
    expect(redeemed.status).toBe(200);
    expect((await rolesOf("v1"))[person.id]).toBe("write");
    expect((await call(back, "GET", "/v1/venues/v1/agenda?date=2026-11-12")).status).toBe(200);
  });
});

describe("last admin", () => {
  it("refuses to remove the only admin, even by themselves", async () => {
    const admin = await adminOf("v1");
    const res = await remove(admin, "v1", admin.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect((await rolesOf("v1"))[admin.id]).toBe("admin");
    expect((await list(admin, "v1")).status).toBe(200);
  });

  it("refuses the last admin while other members remain", async () => {
    const admin = await adminOf("v1");
    await memberOf("v1", "write");
    await memberOf("v1", "read");
    const res = await remove(admin, "v1", admin.id);
    expect(res.status).toBe(409);
    expect(await adminCount("v1")).toBe(1);
  });

  it("allows removing an admin while another admin remains, then protects the survivor", async () => {
    const first = await adminOf("v1");
    const second = await memberOf("v1", "admin");
    expect((await remove(first, "v1", second.id)).status).toBe(200);
    const res = await remove(first, "v1", first.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect(await adminCount("v1")).toBe(1);
  });

  it("counts admins per venue, not across venues", async () => {
    const a = await adminOf("v1");
    const b = await adminOf("v2");
    await addMembership(db, a.id, "v2", "write");
    await addMembership(db, b.id, "v1", "write");
    const res = await remove(a, "v1", a.id);
    expect(res.status).toBe(409);
  });

  it("keeps an admin when two admins remove each other at once", async () => {
    const rounds = 12;
    const one = await signUp();
    const two = await signUp();
    // An anchor venue keeps both sessions alive across rounds.
    await createVenue(db, one.id, { id: "anchor", name: "anchor" });
    await addMembership(db, two.id, "anchor", "read");
    for (let i = 0; i < rounds; i++) {
      const venueId = `race-${i}`;
      await createVenue(db, one.id, { id: venueId, name: venueId });
      await addMembership(db, two.id, venueId, "admin");
      const results = await Promise.all([
        remove(one, venueId, two.id),
        remove(two, venueId, one.id),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(await adminCount(venueId), `round ${i}: ${statuses}`).toBeGreaterThanOrEqual(1);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      const loser = results.find((r) => r.status !== 200)!;
      expect([404, 409]).toContain(loser.status);
      expect(["venue_not_found", "last_admin"]).toContain((await loser.json()).code);
    }
  });

  it("keeps an admin when three admins remove each other in a ring", async () => {
    const people = [await signUp(), await signUp(), await signUp()];
    await createVenue(db, people[0].id, { id: "anchor", name: "anchor" });
    await addMembership(db, people[1].id, "anchor", "read");
    await addMembership(db, people[2].id, "anchor", "read");
    for (let i = 0; i < 8; i++) {
      const venueId = `ring-${i}`;
      await createVenue(db, people[0].id, { id: venueId, name: venueId });
      await addMembership(db, people[1].id, venueId, "admin");
      await addMembership(db, people[2].id, venueId, "admin");
      await Promise.all(
        people.map((p, j) => remove(p, venueId, people[(j + 1) % 3].id)),
      );
      expect(await adminCount(venueId), `round ${i}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the venue usable after racing removals", async () => {
    const one = await signUp();
    const two = await signUp();
    await createVenue(db, one.id, { id: "v1", name: "v1" });
    await addMembership(db, two.id, "v1", "admin");
    await Promise.all([remove(one, "v1", two.id), remove(two, "v1", one.id)]);
    const survivor = (await rolesOf("v1"))[one.id] ? one : two;
    expect((await list(survivor, "v1")).status).toBe(200);
    expect(
      (await call(survivor, "POST", "/v1/venues/v1/invitations", { role: "read" })).status,
    ).toBe(201);
  });

  it("gives a removed admin no further access to remove anyone", async () => {
    const first = await adminOf("v1");
    const second = await memberOf("v1", "admin");
    const third = await memberOf("v1", "admin");
    await adminOf("v2");
    await addMembership(db, second.id, "v2", "read");
    await remove(first, "v1", second.id);
    const res = await remove(second, "v1", third.id);
    expect(res.status).toBe(404);
    expect((await rolesOf("v1"))[third.id]).toBe("admin");
    // With no membership left the session is gone, so the same call is unauthorized.
    const lone = await memberOf("v1", "admin");
    await remove(first, "v1", lone.id);
    expect((await remove(lone, "v1", third.id)).status).toBe(401);
  });
});
