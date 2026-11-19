// pnpm demo:cleanup. Deletes sandboxes whose owner last signed in more than 14 days ago, and their accounts, and
// applies the lead retention. Refuses to run unless DEMO_MODE=1 and the database passes the demo guard, so it can
// never touch a real instance. Safe to run daily from cron.
import { db } from "../db/client";
import { cleanupExpiredSandboxes } from "./cleanup";
import { assertDemoDatabase } from "./guard";
import { demoMode } from "./settings";

if (!demoMode()) {
  console.error("demo cleanup refused: it only runs with DEMO_MODE=1, on the demo's own database.");
  process.exit(1);
}
await assertDemoDatabase(db, true);
const result = await cleanupExpiredSandboxes(db);
console.log(
  `demo cleanup: ${result.sandboxes} sandboxes and ${result.accounts} accounts deleted, ${result.orphanAccounts} accounts without a sandbox, ${result.leads} leads past retention`,
);
process.exit(0);
