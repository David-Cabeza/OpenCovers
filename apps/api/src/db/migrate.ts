import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client";

export async function migrateDb(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS btree_gist`);
  await migrate(db, { migrationsFolder: "migrations" });
}
