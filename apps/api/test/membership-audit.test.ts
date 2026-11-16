import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { membershipAudit, venues } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { addMembership, type Role } from "../src/lib/memberships";
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

const TOKEN_HEADER = "x-invitation-token";
const DAY = 86_400_000;

let n = 0;
interface Account {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

async function signUp(headers?: Record<string, string>): Promise<Account> {
  n += 1;
  const email = `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`;
  const name = `Staff Person ${n}`;
  const res = await auth.api.signUpEmail({
    body: { name, email, password: "password123" },
    headers: new Headers(headers),
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return { id: body.user.id, email, name, cookie };
}

async function adminOf(venueId: string): Promise<Account> {
  const account = await signUp();
  await createVenue(db, account.id, { id: venueId, name: venueId });
  return account;
}

function call(who: Account, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Cookie: who.cookie, "content-type": "application/json" },
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
  return (await res.json()).invitation as { id: string; token: string };
}

const redeem = (who: Account, token: string) =>
  call(who, "POST", "/v1/invitations/redeem", { token });
const revoke = (admin: Account, venueId: string, id: string) =>
  call(admin, "DELETE", `/v1/venues/${venueId}/invitations/${id}`);
const remove = (admin: Account, venueId: string, userId: string) =>
  call(admin, "DELETE", `/v1/venues/${venueId}/members/${userId}`);

async function rows(venueId?: string) {
  const all = await db.select().from(membershipAudit).orderBy(membershipAudit.id);
  return venueId ? all.filter((r) => r.venueId === venueId) : all;
}

describe("one row per event", () => {
  it("records an invitation with its admin, id and role, and no target", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write", email: "maria@example.com" });
    expect(await rows()).toMatchObject([
      {
        venueId: "v1",
        action: "invited",
        actorUserId: admin.id,
        targetUserId: null,
        invitationId: created.id,
        role: "write",
      },
    ]);
  });

  it("records a revoke once, and writes nothing for a repeat", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "admin" });
    expect((await revoke(admin, "v1", created.id)).status).toBe(200);
    expect((await revoke(admin, "v1", created.id)).status).toBe(200);
    const [, revoked, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(revoked).toMatchObject({
      action: "invite_revoked",
      actorUserId: admin.id,
      targetUserId: null,
      invitationId: created.id,
      role: "admin",
    });
  });

  it("records a redemption by a signed-in account with the redeemer as target", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    const guest = await signUp();
    expect((await redeem(guest, created.token)).status).toBe(200);
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({
      action: "redeemed",
      actorUserId: null,
      targetUserId: guest.id,
      invitationId: created.id,
      role: "write",
    });
  });

  it("records a redemption by signing up with the new account as target", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "read" });
    const guest = await signUp({ [TOKEN_HEADER]: created.token });
    const all = await rows();
    expect(all.map((r) => r.action)).toEqual(["invited", "redeemed"]);
    expect(all[1]).toMatchObject({
      targetUserId: guest.id,
      invitationId: created.id,
      role: "read",
    });
  });

  it("records a removal with actor, target and the removed role", async () => {
    const admin = await adminOf("v1");
    const other = await signUp();
    await addMembership(db, other.id, "v1", "write");
    expect((await remove(admin, "v1", other.id)).status).toBe(200);
    expect(await rows()).toMatchObject([
      {
        venueId: "v1",
        action: "member_removed",
        actorUserId: admin.id,
        targetUserId: other.id,
        invitationId: null,
        role: "write",
      },
    ]);
  });
});

describe("a change that does not happen writes no row", () => {
  it("writes nothing for a refused removal, a missing member or a non-admin caller", async () => {
    const admin = await adminOf("v1");
    const writer = await signUp();
    await addMembership(db, writer.id, "v1", "write");
    const stranger = await signUp();
    expect((await (await remove(admin, "v1", admin.id)).json()).code).toBe("last_admin");
    expect((await remove(admin, "v1", stranger.id)).status).toBe(404);
    expect((await remove(writer, "v1", admin.id)).status).toBe(403);
    expect(await rows()).toHaveLength(0);
  });

  it("writes nothing for a revoke of a redeemed invitation or a foreign one", async () => {
    const admin = await adminOf("v1");
    const other = await adminOf("v2");
    const created = await invite(admin, "v1");
    await redeem(await signUp(), created.token);
    const before = (await rows()).length;
    expect((await revoke(admin, "v1", created.id)).status).toBe(409);
    expect((await revoke(other, "v2", created.id)).status).toBe(404);
    expect(await rows()).toHaveLength(before);
  });

  it("writes nothing for a refused, unknown or already used redemption", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "read", email: "bound@example.com" });
    const guest = await signUp();
    expect((await redeem(guest, created.token)).status).toBe(400);
    expect((await redeem(guest, "nope.nope")).status).toBe(400);
    expect((await rows()).map((r) => r.action)).toEqual(["invited"]);
  });

  it("rolls the audit row back when the change fails", async () => {
    await adminOf("v1");
    await expect(
      db.transaction(async (tx) => {
        const { recordMembershipAudit } = await import("../src/lib/membership-audit");
        await recordMembershipAudit(tx, "v1", {
          action: "member_removed",
          actorUserId: "a",
          targetUserId: "b",
          role: "read",
        });
        throw new Error("change failed");
      }),
    ).rejects.toThrow("change failed");
    expect(await rows()).toHaveLength(0);
  });
});

describe("isolation and content", () => {
  it("keeps each venue's rows apart", async () => {
    const a = await adminOf("va");
    const b = await adminOf("vb");
    await invite(a, "va");
    await invite(b, "vb");
    await invite(b, "vb");
    expect(await rows("va")).toHaveLength(1);
    expect(await rows("vb")).toHaveLength(2);
    expect((await rows("va"))[0].actorUserId).toBe(a.id);
  });

  it("stores no email, name or token in any row", async () => {
    const admin = await adminOf("v1");
    const created = await invite(admin, "v1", { role: "write" });
    const guest = await signUp();
    await redeem(guest, created.token);
    const second = await invite(admin, "v1", { role: "read", email: "maria@example.com" });
    await revoke(admin, "v1", second.id);
    await remove(admin, "v1", guest.id);
    const text = JSON.stringify(await rows());
    expect(await rows()).toHaveLength(5);
    for (const secret of [
      admin.email,
      admin.name,
      guest.email,
      guest.name,
      "maria@example.com",
      created.token,
      created.token.split(".")[1],
      second.token,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("@");
  });

  it("survives deleting the account that acted", async () => {
    const admin = await adminOf("v1");
    await invite(admin, "v1");
    await db.execute(sql`DELETE FROM "user" WHERE id = ${admin.id}`);
    expect(await rows("v1")).toHaveLength(1);
  });
});

describe("concurrent redemption", () => {
  it("writes exactly one redeemed row for signed-in accounts", async () => {
    const admin = await adminOf("v1");
    for (let round = 0; round < 4; round++) {
      const created = await invite(admin, "v1", { role: "write" });
      const guests = await Promise.all(Array.from({ length: 8 }, () => signUp()));
      await Promise.all(guests.map((g) => redeem(g, created.token)));
      const redeemed = (await rows()).filter(
        (r) => r.action === "redeemed" && r.invitationId === created.id,
      );
      expect(redeemed).toHaveLength(1);
    }
  });

  it("writes exactly one redeemed row for concurrent sign-ups", async () => {
    const admin = await adminOf("v1");
    for (let round = 0; round < 3; round++) {
      const created = await invite(admin, "v1");
      await Promise.allSettled(
        Array.from({ length: 6 }, () => signUp({ [TOKEN_HEADER]: created.token })),
      );
      const redeemed = (await rows()).filter(
        (r) => r.action === "redeemed" && r.invitationId === created.id,
      );
      expect(redeemed).toHaveLength(1);
    }
  });
});

describe("retention", () => {
  async function age(venueId: string, daysAgo: number, action: "invited" | "redeemed") {
    await db.insert(membershipAudit).values({
      venueId,
      action,
      role: "read" as Role,
      occurredAt: new Date(Date.now() - daysAgo * DAY),
    });
  }

  it("removes only rows older than the venue's period and respects per-venue periods", async () => {
    await db.insert(venues).values([
      { id: "short", retentionDays: 30 },
      { id: "long", retentionDays: 400 },
    ]);
    await age("short", 31, "invited");
    await age("short", 29, "invited");
    await age("long", 31, "invited");
    await age("long", 401, "redeemed");
    await runRetention(db);
    const left = await db.select().from(membershipAudit);
    expect(left.map((r) => `${r.venueId}`).sort()).toEqual(["long", "short"]);
    const ages = left.map((r) => Math.round((Date.now() - r.occurredAt.getTime()) / DAY)).sort();
    expect(ages).toEqual([29, 31]);
  });

  it("prunes in bounded batches over several runs", async () => {
    await db.insert(venues).values({ id: "v1", retentionDays: 30 });
    for (let i = 0; i < 5; i++) await age("v1", 60, "invited");
    await runRetention(db, new Date(), { size: 2, perRun: 2 });
    expect(await db.select().from(membershipAudit)).toHaveLength(1);
    await runRetention(db, new Date(), { size: 2, perRun: 2 });
    expect(await db.select().from(membershipAudit)).toHaveLength(0);
  });

  it("leaves the invitation rows to their own retention and keeps recent audit", async () => {
    const admin = await adminOf("v1");
    await invite(admin, "v1");
    await runRetention(db);
    expect(await db.select().from(membershipAudit).where(eq(membershipAudit.venueId, "v1"))).toHaveLength(1);
  });
});
