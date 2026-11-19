// pnpm demo:leads. Prints the visitors who agreed to be contacted, as CSV on stdout. The only way leads leave the
// database: no HTTP route returns them.
import { db } from "../db/client";
import { consentedLeadsCsv } from "./leads";

process.stdout.write(await consentedLeadsCsv(db));
process.exit(0);
