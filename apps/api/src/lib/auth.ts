import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { db } from "../db/client";
import { betterAuthSchema, user } from "../db/schema";
import { eq } from "drizzle-orm";
import { admissionFor, admissionForEmail, DemoRefusal, REFUSALS, type Refusal } from "../demo/admission";
import { isDisposableEmail } from "../demo/disposable";
import { touchLead } from "../demo/leads";
import { normalizeEmail } from "../demo/normalize";
import { magicLinkChallenges, type MagicLinkChallenges } from "../demo/magic-link-challenge";
import { provisionSandbox } from "../demo/provision";
import { demoSettings, type DemoSettings } from "../demo/settings";
import { deleteSandboxlessAccount } from "../demo/cleanup";
import {
  INVITATION_TOKEN_HEADER,
  claimForSignup,
  grantClaimedInvitation,
} from "./invitations";
import { buildMagicLinkEmail, sendEmail } from "./mailer";
import { LOCALES } from "./online-booking";
import { decideSignup, signupMode } from "./signup";

function invitationToken(
  context: { headers?: Headers; request?: Request } | null,
): string | null {
  const value = (context?.headers ?? context?.request?.headers)?.get(INVITATION_TOKEN_HEADER);
  return value ? value : null;
}

/** The browser origins that may sign in and send cookie-authenticated writes (lib/staff-origin.ts). */
export const trustedOrigins = [
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  ...(process.env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]),
];

export function magicLinkEmail(locale: string, url: string): { subject: string; text: string; html: string } {
  const { subject, text, html } = buildMagicLinkEmail(locale, url);
  return { subject, text, html };
}

/** The language of the mail: the first supported language of Accept-Language, else English. */
function mailLocale(headers: Headers | undefined): string {
  const first = headers?.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim().toLowerCase().slice(0, 2) ?? "";
  return (LOCALES as readonly string[]).includes(first) ? first : "en";
}

/** Google's `email_verified` claim must be true: an unverified address proves nothing about who holds the inbox. */
export function requireVerifiedGoogleEmail(profile: { email_verified?: boolean }): Record<string, never> {
  if (profile.email_verified !== true) {
    throw new APIError("FORBIDDEN", {
      code: "EMAIL_NOT_VERIFIED",
      message: "Your Google account has no verified email address.",
    });
  }
  return {};
}

const CHALLENGE_MESSAGES = {
  CHALLENGE_REQUIRED: "Solve the sign-in challenge first. Ask POST /api/demo/magic-link-challenge for one.",
  CHALLENGE_INVALID:
    "The sign-in challenge is wrong, expired, already used or was issued for another address. Ask for a new one.",
} as const;

const DISPOSABLE = {
  code: "DISPOSABLE_EMAIL",
  message: "Disposable email addresses are not accepted. Use your own address.",
} as const;

function refusal(reason: Refusal): APIError {
  const status = reason === "busy" ? "TOO_MANY_REQUESTS" : reason === "invalid_address" ? "BAD_REQUEST" : "FORBIDDEN";
  return new APIError(status, REFUSALS[reason]);
}

export interface AuthDeps {
  /** Delivers the magic link mail. Default: Resend through `sendEmail`. A test passes a capture. */
  sendMail?: (to: string, subject: string, text: string, html?: string) => Promise<void>;
  /** The magic link challenge issuer and checker. Default: the process-wide one. A test passes one with its own clock. */
  challenges?: () => MagicLinkChallenges;
}

/**
 * The account system. `settings` decides whether this is the hosted demo (ADR-0022): with it off, the instance is
 * exactly what it was before the demo existed. Exported as a factory so a test can build the demo variant.
 */
export function createAuth(settings: DemoSettings, deps: AuthDeps = {}) {
  const challenges = deps.challenges ?? magicLinkChallenges;
  const demo = settings.enabled;

  async function onSession(session: { userId: string }) {
    const [account] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1);
    if (!account) return;
    // Consent is never recorded here. A visitor who consented earlier keeps the 12 months running.
    await touchLead(db, account.email);
    try {
      await provisionSandbox(db, session.userId);
    } catch (error) {
      if (error instanceof DemoRefusal) {
        // The demo is full, or this address already has a sandbox under another spelling. Leave no account behind,
        // unless it already owns a sandbox (a returning visitor never gets here).
        await deleteSandboxlessAccount(db, session.userId);
        throw refusal(error.reason);
      }
      // The sign-in stands. The next one builds the sandbox again, because provisioning is idempotent.
      console.error("demo sandbox provisioning failed", error);
    }
  }

  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    database: drizzleAdapter(db, { provider: "pg", schema: betterAuthSchema }),
    emailAndPassword: { enabled: !demo },
    // lib/rate-limit.ts limits /api/auth. Better Auth's own limiter would answer a second 429 in another shape.
    rateLimit: { enabled: false },
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
    ...(demo
      ? {
          plugins: [
            magicLink({
              // The token in the database is a hash, so a read of `verification` yields no usable link (audit F13).
              storeToken: "hashed",
              sendMagicLink: async ({ email, url }, context) => {
                const { subject, text, html } = magicLinkEmail(mailLocale(context?.headers ?? context?.request?.headers), url);
                if (deps.sendMail) return deps.sendMail(email, subject, text, html);
                // Never log the link: whoever reads the log would sign in as the visitor.
                if (!settings.mailConfigured) {
                  console.warn("demo magic link not delivered: set RESEND_API_KEY and RESEND_FROM_EMAIL");
                  return;
                }
                await sendEmail("", "", email, subject, text, html);
              },
            }),
          ],
          socialProviders: settings.google
            ? {
                google: {
                  clientId: settings.google.clientId,
                  clientSecret: settings.google.clientSecret,
                  mapProfileToUser: requireVerifiedGoogleEmail,
                },
              }
            : undefined,
          hooks: {
            before: createAuthMiddleware(async (ctx) => {
              if (ctx.path !== "/sign-in/magic-link") return;
              const email = (ctx.body as { email?: unknown } | undefined)?.email;
              // A body with no usable address never reaches the limits or the mailer (audit F3c).
              if (typeof email !== "string" || normalizeEmail(email) === null) throw refusal("invalid_address");
              if (isDisposableEmail(email)) throw new APIError("BAD_REQUEST", DISPOSABLE);
              // ADR-0022, decision 8(a). The answer never depends on whether the address has an account.
              const challenge = challenges().check(email, ctx.headers ?? undefined);
              if (challenge) throw new APIError("BAD_REQUEST", { code: challenge, message: CHALLENGE_MESSAGES[challenge] });
              const refused = await admissionForEmail(db, email);
              if (refused) throw refusal(refused);
            }),
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          before: async (account, context) => {
            if (demo) {
              if (isDisposableEmail(account.email)) throw new APIError("BAD_REQUEST", DISPOSABLE);
              // Before the account exists, for the magic link and for Google alike: one sandbox per normalized
              // address, and the caps (audit F4). provisionSandbox checks again under its lock.
              const normalized = normalizeEmail(account.email);
              if (normalized === null) throw refusal("invalid_address");
              const refused = await admissionFor(db, normalized, null);
              if (refused) throw refusal(refused);
              return { data: { firstSignup: false } };
            }
            const token = invitationToken(context);
            if (token !== null) {
              if (!(await claimForSignup(db, token, account.email))) {
                throw new APIError("FORBIDDEN", {
                  code: "INVALID_INVITATION",
                  message: "This invitation is not valid.",
                });
              }
              return { data: { firstSignup: false } };
            }
            const decision = await decideSignup(db, signupMode());
            if (!decision.allowed) {
              throw new APIError("FORBIDDEN", {
                code: "SIGNUP_CLOSED",
                message: "Sign-up is closed on this instance.",
              });
            }
            return { data: { firstSignup: decision.firstSignup } };
          },
          after: async (account, context) => {
            if (demo) return;
            const token = invitationToken(context);
            if (token !== null) await grantClaimedInvitation(db, token, account.id);
          },
        },
      },
      ...(demo ? { session: { create: { after: onSession } } } : {}),
    },
    trustedOrigins,
  });
}

export const auth = createAuth(demoSettings());
