import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { poolSettings } from "../demo/settings";
import * as schema from "./schema";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/opencovers",
  // A request that cannot get a connection fails after the timeout instead of waiting forever (ADR-0022 audit F1).
  ...poolSettings(),
});

export const db = drizzle(pool, { schema });
