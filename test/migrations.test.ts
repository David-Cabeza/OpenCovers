import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { applyMigrations } from "../src/migrations";

const testEnv = env as unknown as Env;

function venue(name: string) {
  const id = testEnv.VENUE.idFromName(name);
  return testEnv.VENUE.get(id);
}

const demoMigrations = [
  { version: 100, sql: "CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY)" },
  { version: 101, sql: "ALTER TABLE demo ADD COLUMN name TEXT NOT NULL DEFAULT ''" },
];

describe("schema migrations", () => {
  it("applies a pending migration to an existing object", async () => {
    const v = venue("migrate");
    await runInDurableObject(v, (_instance, state) => {
      state.storage.sql.exec("CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY)");
      state.storage.sql.exec(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (100, 0)",
      );
    });

    await runInDurableObject(v, (_instance, state) => {
      applyMigrations(state.storage.sql, state.storage, demoMigrations);
    });

    await runInDurableObject(v, (_instance, state) => {
      state.storage.sql.exec("SELECT name FROM demo LIMIT 1");
    });
  });

  it("records the venue schema version", async () => {
    const v = venue("migrate-version");
    await v.getConfig();
    const rows = await runInDurableObject(v, (_instance, state) => {
      return state.storage.sql
        .exec<{ version: number }>("SELECT version FROM schema_migrations")
        .toArray();
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });
});
