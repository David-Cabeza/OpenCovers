import { db } from "./client";
import { backfillGuests } from "../lib/guests";
import { migrateDb } from "./migrate";

await migrateDb();
console.log("migrations applied");
const backfill = await backfillGuests(db);
console.log(
  `guest backfill: ${backfill.createdGuests} guests created, ${backfill.linkedReservations} reservations linked`,
);
process.exit(0);
