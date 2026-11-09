import { sql } from "drizzle-orm";
import { migrateDb } from "../src/db/migrate";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("auth", () => {
  it("signs up a user and stores the account", async () => {
    const res = await auth.api.signUpEmail({
      body: {
        name: "Staff User",
        email: "staff@example.com",
        password: "password123",
      },
    });
    expect(res.error).toBeUndefined();

    const users = await db.select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("staff@example.com");
    expect(users[0].emailVerified).toBe(false);
  });
});
