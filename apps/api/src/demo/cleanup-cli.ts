// pnpm demo:cleanup. Deletes sandboxes whose owner last signed in more than 14 days ago, and their accounts.
// Keeps demo leads. Safe to run daily from cron.
import { db } from "../db/client";
import { cleanupExpiredSandboxes } from "./cleanup";

const result = await cleanupExpiredSandboxes(db);
console.log(`demo cleanup: ${result.sandboxes} sandboxes and ${result.accounts} accounts deleted`);
process.exit(0);
