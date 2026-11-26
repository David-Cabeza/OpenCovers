// C82: what the API process does with `DIETARY` at startup (ADR-0027, decisions 3 and 11).
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, venues } from "../src/db/schema";

const API = new URL("..", import.meta.url).pathname;

/** Starts the API and resolves with what it printed, once it printed `until` or exited. */
function start(env: Record<string, string>, until = /^dietary: .*$/m): Promise<{ output: string; code: number | null }> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: API,
    env: { ...process.env, PORT: "0", ...env },
  });
  let output = "";
  return new Promise((resolve) => {
    const read = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (until.test(output)) child.kill();
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("close", (code) => resolve({ output, code }));
  });
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`delete from demo_sandbox`);
  await db.insert(venues).values({ id: "start", timezone: "Europe/Madrid" });
  const startsAt = new Date("2030-01-05T20:00:00Z");
  const row = { venueId: "start", date: "2030-01-05", startsAt, endsAt: new Date("2030-01-05T22:00:00Z"), partySize: 2, status: "booked" };
  const value = { allergens: ["molluscs" as const], diets: [], note: "zzstartupmark", recordedAt: startsAt.toISOString(), recordedBy: null };
  await db.insert(reservations).values([
    { ...row, id: "start-1", dietary: value },
    { ...row, id: "start-2", dietary: value },
    { ...row, id: "start-3" },
  ]);
});

describe("the DIETARY switch at startup", () => {
  it("stops the API on any value but on and off", async () => {
    for (const DIETARY of ["yes", "1", "ON"]) {
      const { output, code } = await start({ DIETARY }, /listening on port/);
      expect(output).toContain(`DIETARY must be on or off. Got "${DIETARY}".`);
      expect(output).not.toContain("listening on port");
      expect(code).not.toBe(0);
    }
  }, 60_000);

  it("off, logs how many reservations hold a value and never a value", async () => {
    for (const DIETARY of ["off", ""]) {
      const { output } = await start({ DIETARY });
      expect(output).toContain("dietary: off (reservations holding a stored value: 2)");
      expect(output).not.toContain("zzstartupmark");
      expect(output).not.toContain("molluscs");
    }
  }, 60_000);

  it("on, says so", async () => {
    expect((await start({ DIETARY: "on" })).output).toContain("dietary: on");
  }, 60_000);
});
