import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { db } from "../db/client";
import { betterAuthSchema } from "../db/schema";
import { decideSignup, signupMode } from "./signup";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg", schema: betterAuthSchema }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      firstSignup: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
        returned: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const decision = await decideSignup(db, signupMode());
          if (!decision.allowed) {
            throw new APIError("FORBIDDEN", {
              code: "SIGNUP_CLOSED",
              message: "Sign-up is closed on this instance.",
            });
          }
          return { data: { firstSignup: decision.firstSignup } };
        },
      },
    },
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ...(process.env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]),
  ],
});
