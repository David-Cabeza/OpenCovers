import { migrateDb } from "./migrate";

await migrateDb();
console.log("migrations applied");
process.exit(0);
