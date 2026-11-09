import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client";
import { betterAuthSchema } from "../db/schema";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg", schema: betterAuthSchema }),
  emailAndPassword: { enabled: true },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ...(process.env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]),
  ],
});
