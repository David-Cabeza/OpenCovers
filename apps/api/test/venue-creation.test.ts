import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { user, venues } from "../src/db/schema";
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

type Caller = Partial<Account> & { apikey?: string };

let n = 0;
async function signUp(headers?: Record<string, string>): Promise<Account> {
  n += 1;
  const res = await auth.api.signUpEmail({
    body: {
      name: "Staff",
      email: `staff-${n}-${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
    },
    headers: new Headers(headers),
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return { id: body.user.id, cookie };
}

function call(who: Caller, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...(who.cookie ? { Cookie: who.cookie } : {}),
      ...(who.apikey ? { apikey: who.apikey } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function postVenue(who: Caller, name = "New venue") {
  return call(who, "POST", "/v1/venues", { name });
}

async function venueCount(): Promise<number> {
  return (await db.select().from(venues)).length;
}

async function ownerWithVenue(venueId = "owner-venue"): Promise<Account> {
  process.env.SIGNUP = "first-user";
  const owner = await signUp();
  const res = await call(owner, "POST", "/v1/venues", { id: venueId, name: venueId });
  expect(res.status).toBe(201);
  return owner;
}

async function invitedAccount(owner: Account, venueId: string, role: Role): Promise<Account> {
  const res = await call(owner, "POST", `/v1/venues/${venueId}/invitations`, { role });
  expect(res.status).toBe(201);
  const { token } = (await res.json()).invitation as { token: string };
  return signUp({ "x-invitation-token": token });
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({
    code: "venue_creation_closed",
    message: "venue_creation_closed",
    retryable: false,
  });
}

describe("SIGNUP=open", () => {
  it("lets any signed-in account create venues", async () => {
    const a = await signUp();
    const b = await signUp();
    expect((await postVenue(a)).status).toBe(201);
    expect((await postVenue(b)).status).toBe(201);
    expect((await postVenue(b)).status).toBe(201);
    expect(await venueCount()).toBe(3);
  });

  it("lets an invited account create a venue, as before", async () => {
    const admin = await signUp();
    await createVenue(db, admin.id, { id: "v", name: "v" });
    const invited = await invitedAccount(admin, "v", "read");
    expect((await postVenue(invited)).status).toBe(201);
  });

  it("still needs a session", async () => {
    expect((await postVenue({})).status).toBe(401);
    expect(await venueCount()).toBe(0);
  });
});

describe("SIGNUP=first-user", () => {
  it("lets the first owner create the first venue and more after it", async () => {
    process.env.SIGNUP = "first-user";
    const owner = await signUp();
    expect((await postVenue(owner, "First")).status).toBe(201);
    expect((await postVenue(owner, "Second")).status).toBe(201);
    expect(await venueCount()).toBe(2);
  });

  it.each<Role>(["read", "write", "admin"])(
    "refuses an account invited as %s",
    async (role) => {
      const owner = await ownerWithVenue();
      const invited = await invitedAccount(owner, "owner-venue", role);
      await expectRefused(await postVenue(invited));
      expect(await venueCount()).toBe(1);
    },
  );

  it("refuses before it validates the body", async () => {
    const owner = await ownerWithVenue();
    const invited = await invitedAccount(owner, "owner-venue", "read");
    await expectRefused(await call(invited, "POST", "/v1/venues", {}));
  });

  it("refuses an existing venue admin that is not the owner", async () => {
    process.env.SIGNUP = "open";
    const legacy = await signUp();
    await createVenue(db, legacy.id, { id: "legacy-venue", name: "Legacy" });
    process.env.SIGNUP = "first-user";
    await expectRefused(await postVenue(legacy));
    expect(await venueCount()).toBe(1);
    expect((await call(legacy, "GET", "/v1/venues/legacy-venue/config")).status).toBe(200);
  });

  it("lets the invited account read and run the venue it was invited to", async () => {
    const owner = await ownerWithVenue();
    const invited = await invitedAccount(owner, "owner-venue", "admin");
    await expectRefused(await postVenue(invited));

    const list = await call(invited, "GET", "/v1/venues");
    expect(list.status).toBe(200);
    expect((await list.json()).venues).toEqual([
      expect.objectContaining({ id: "owner-venue", role: "admin" }),
    ]);
    expect((await call(invited, "GET", "/v1/venues/owner-venue/config")).status).toBe(200);
  });

  it("lists the owner's venues, unchanged", async () => {
    const owner = await ownerWithVenue();
    await postVenue(owner, "Second");
    const list = await call(owner, "GET", "/v1/venues");
    expect((await list.json()).venues).toHaveLength(2);
  });

  it("keeps the owner able to create venues across requests", async () => {
    const owner = await ownerWithVenue();
    for (let i = 0; i < 3; i++) expect((await postVenue(owner)).status).toBe(201);
    expect(await venueCount()).toBe(4);
  });
});

describe("SIGNUP=closed", () => {
  it("lets the marked owner create venues after the instance closes", async () => {
    const owner = await ownerWithVenue();
    process.env.SIGNUP = "closed";
    expect((await postVenue(owner, "After closing")).status).toBe(201);
    expect(await venueCount()).toBe(2);
  });

  it.each<Role>(["read", "write", "admin"])(
    "refuses an account invited as %s",
    async (role) => {
      const owner = await ownerWithVenue();
      process.env.SIGNUP = "closed";
      const invited = await invitedAccount(owner, "owner-venue", role);
      await expectRefused(await postVenue(invited));
      expect(await venueCount()).toBe(1);
    },
  );

  it("refuses an unmarked account that administers a venue and keeps its venue", async () => {
    const legacy = await signUp();
    await createVenue(db, legacy.id, { id: "legacy-venue", name: "Legacy" });
    process.env.SIGNUP = "closed";
    await expectRefused(await postVenue(legacy));
    expect((await call(legacy, "GET", "/v1/venues/legacy-venue/config")).status).toBe(200);
  });

  it("refuses an account added to a venue as a member by other means", async () => {
    await ownerWithVenue();
    process.env.SIGNUP = "open";
    const extra = await signUp();
    process.env.SIGNUP = "closed";
    await addMembership(db, extra.id, "owner-venue", "admin");
    await expectRefused(await postVenue(extra));
    expect(await venueCount()).toBe(1);
  });

  it("lets an operator mark an upgraded account with SQL", async () => {
    const legacy = await signUp();
    await createVenue(db, legacy.id, { id: "legacy-venue", name: "Legacy" });
    process.env.SIGNUP = "closed";
    await expectRefused(await postVenue(legacy));
    await db.update(user).set({ firstSignup: true }).where(eq(user.id, legacy.id));
    expect((await postVenue(legacy)).status).toBe(201);
  });

  it("leaves nobody able to create a venue when no account is marked", async () => {
    const a = await signUp();
    const b = await signUp();
    process.env.SIGNUP = "closed";
    await expectRefused(await postVenue(a));
    await expectRefused(await postVenue(b));
    expect(await venueCount()).toBe(0);
  });
});

describe("the mode is read on every request", () => {
  it("follows SIGNUP without a restart", async () => {
    const owner = await ownerWithVenue();
    const invited = await invitedAccount(owner, "owner-venue", "read");
    process.env.SIGNUP = "open";
    expect((await postVenue(invited)).status).toBe(201);
    process.env.SIGNUP = "first-user";
    await expectRefused(await postVenue(invited));
    process.env.SIGNUP = "closed";
    await expectRefused(await postVenue(invited));
  });
});

describe("API keys", () => {
  it.each<Role>(["read", "write", "admin"])(
    "never create a venue: a %s key alone is unauthorized in every mode",
    async (role) => {
      await addKey(db, `key-${role}`, "agent", ["*"], role);
      for (const mode of ["open", "first-user", "closed"]) {
        process.env.SIGNUP = mode;
        expect((await postVenue({ apikey: `key-${role}` })).status).toBe(401);
      }
      expect(await venueCount()).toBe(0);
    },
  );

  it("add nothing next to a session that is refused", async () => {
    const owner = await ownerWithVenue();
    const invited = await invitedAccount(owner, "owner-venue", "admin");
    await addKey(db, "star-admin", "agent", ["*"], "admin");
    await expectRefused(await postVenue({ ...invited, apikey: "star-admin" }));
    expect(await venueCount()).toBe(1);
  });

  it("do not take away the owner's right when sent beside the owner's session", async () => {
    const owner = await ownerWithVenue();
    await addKey(db, "read-key", "agent", ["*"], "read");
    expect((await postVenue({ ...owner, apikey: "read-key" })).status).toBe(201);
  });
});
