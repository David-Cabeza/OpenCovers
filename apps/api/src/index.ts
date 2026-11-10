import { serve } from "@hono/node-server";
import app from "./app";
import { db } from "./db/client";
import { runRetention } from "./lib/reservations";

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`opencovers api listening on port ${info.port}`);
});

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  runRetention(db).catch((err) => console.error("retention failed", err));
}, RETENTION_INTERVAL_MS);
