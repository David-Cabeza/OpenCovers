// pnpm demo:leads. Prints the visitors who agreed to be contacted and have not withdrawn, as CSV on stdout. The only
// way leads leave the database: no HTTP route returns them.
// pnpm demo:leads --erase <email> deletes that address's lead row (an erasure request) and prints how many rows went.
import { db } from "../db/client";
import { consentedLeadsCsv, eraseLead } from "./leads";

const args = process.argv.slice(2);
if (args[0] === "--erase") {
  const email = args[1];
  if (!email || args.length !== 2) {
    console.error("usage: pnpm demo:leads --erase <email>");
    process.exit(2);
  }
  console.log(`demo leads: ${await eraseLead(db, email)} row(s) erased`);
} else if (args.length > 0) {
  console.error("usage: pnpm demo:leads [--erase <email>]");
  process.exit(2);
} else {
  process.stdout.write(await consentedLeadsCsv(db));
}
process.exit(0);
