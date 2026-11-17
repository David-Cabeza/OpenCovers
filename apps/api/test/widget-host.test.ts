import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => {
  const before = { WIDGET_ADDRESS: process.env.WIDGET_ADDRESS, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL };
  process.env.WIDGET_ADDRESS = "book.example.com";
  process.env.BETTER_AUTH_URL = "https://app.example.com";
  return before;
});

afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

let bookingKey = "";

beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-host-"));
  mkdirSync(path.join(dist, ".vite"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, ".vite", "manifest.json"), JSON.stringify({ "src/main.tsx": { file: "assets/main-A1.js" } }));
  writeFileSync(path.join(dist, "assets", "main-A1.js"), "");
  process.env.WIDGET_DIST = dist;
  await migrateDb();
  await db.execute(sql`TRUNCATE TABLE api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`);
  await db.insert(venues).values({ id: "whost", name: "Casa", timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: "whost", name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values({ id: "whost-t0", venueId: "whost", name: "T0", seats: 4 });
  await addKey(db, "whost-admin", "admin", ["whost"], "admin");
  const res = await app.request("/v1/venues/whost/online-booking", {
    method: "PUT",
    headers: { apikey: "whost-admin", "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, allowedOrigins: ["https://casa.example"] }),
  });
  bookingKey = (await res.json()).bookingKey;
});

it("serves the widget page and assets on the widget host only; the staff host gets the unknown-key page", async () => {
  const widget = await app.request(`http://book.example.com/w/${bookingKey}`);
  expect(widget.status).toBe(200);
  expect(widget.headers.get("content-security-policy")).toMatch(/frame-ancestors 'self' https:\/\/casa\.example$/);
  expect((await app.request("http://book.example.com/w/assets/main-A1.js")).status).toBe(200);

  const staff = await app.request(`http://app.example.com/w/${bookingKey}`);
  const unknown = await app.request("http://book.example.com/w/pk_AAAAAAAAAAAAAAAAAAAAAA");
  expect(staff.status).toBe(404);
  expect(Object.fromEntries(staff.headers)).toEqual(Object.fromEntries(unknown.headers));
  expect(await staff.text()).toBe(await unknown.text());
  expect(staff.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'$/);
  expect((await app.request("http://app.example.com/w/assets/main-A1.js")).status).toBe(404);
});

it("serves the self-service page /r on the widget host only, and the staff host gets the same 404", async () => {
  const widget = await app.request("http://book.example.com/r?lang=en");
  expect(widget.status).toBe(200);
  expect(widget.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'$/);
  expect(widget.headers.get("x-frame-options")).toBe("DENY");

  const staff = await app.request("http://app.example.com/r?lang=en");
  const unknown = await app.request("http://book.example.com/w/pk_AAAAAAAAAAAAAAAAAAAAAA");
  expect(staff.status).toBe(404);
  expect(Object.fromEntries(staff.headers)).toEqual(Object.fromEntries(unknown.headers));
  expect(await staff.text()).toBe(await unknown.text());
});
