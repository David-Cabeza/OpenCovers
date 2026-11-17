import { serve } from "@hono/node-server";
import app from "./app";
import { db } from "./db/client";
import { blocklistKeys } from "./lib/blocklist";
import { runRetention } from "./lib/retention";
import { describeRateLimit, rateLimitConfigFromEnv } from "./lib/rate-limit";
import { signupMode } from "./lib/signup";
import { runWebhookDeliveries, webhookDepsFromEnv } from "./lib/webhooks";

const signup = signupMode();
const rateLimit = rateLimitConfigFromEnv();
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`opencovers api listening on port ${info.port} (sign-up: ${signup}, trust proxy: ${rateLimit.trustProxy})`);
  console.log(describeRateLimit(rateLimit));
  console.log(`blocklist key: ${blocklistKeys.current.id}${blocklistKeys.previous ? `, previous: ${blocklistKeys.previous.id}` : ""}`);
});

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  runRetention(db).catch((err) => console.error("retention failed", err));
}, RETENTION_INTERVAL_MS);

const WEBHOOK_INTERVAL_MS = 5_000;
const webhookDeps = webhookDepsFromEnv();
if (webhookDeps.allowInsecure) {
  console.warn("WEBHOOK_ALLOW_INSECURE is on. Webhooks may target http and private addresses.");
}
let delivering = false;
setInterval(async () => {
  if (delivering) return;
  delivering = true;
  try {
    await runWebhookDeliveries(db, webhookDeps);
  } catch (err) {
    console.error("webhook delivery failed", err);
  } finally {
    delivering = false;
  }
}, WEBHOOK_INTERVAL_MS);
