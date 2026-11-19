import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { db } from "../db/client";
import { betterAuthSchema, user } from "../db/schema";
import { eq } from "drizzle-orm";
import { isDisposableEmail } from "../demo/disposable";
import { claimFromHeaders, recordLead, stashClaim, takeClaim, type LeadClaim, type LeadSource } from "../demo/leads";
import { provisionSandbox } from "../demo/provision";
import { demoSettings, type DemoSettings } from "../demo/settings";
import {
  INVITATION_TOKEN_HEADER,
  claimForSignup,
  grantClaimedInvitation,
} from "./invitations";
import { sendEmail } from "./mailer";
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

/** Carries the Google sign-in's consent claim across the redirect to Google and back (ADR-0022, decision 7). */
export const DEMO_CLAIM_COOKIE = "oc_demo_claim";

function encodeClaim(claim: LeadClaim): string {
  return Buffer.from(JSON.stringify(claim)).toString("base64url");
}

function decodeClaim(value: string | null | undefined): LeadClaim | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<LeadClaim>;
    return {
      consentVersion: typeof parsed.consentVersion === "string" ? parsed.consentVersion : null,
      locale: typeof parsed.locale === "string" ? parsed.locale : "en",
      name: typeof parsed.name === "string" ? parsed.name : null,
    };
  } catch {
    return null;
  }
}

export function magicLinkEmail(locale: string, url: string): { subject: string; text: string } {
  if (locale.startsWith("es")) {
    return {
      subject: "Tu enlace para entrar en la demo de OpenCovers",
      text: `Abre este enlace para entrar en la demo de OpenCovers (caduca en 5 minutos):\n\n${url}\n\nSi no lo has pedido tu, ignora este mensaje.`,
    };
  }
  return {
    subject: "Your link to the OpenCovers demo",
    text: `Open this link to sign in to the OpenCovers demo (it expires in 5 minutes):\n\n${url}\n\nIf you did not ask for it, ignore this message.`,
  };
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

const DISPOSABLE = {
  code: "DISPOSABLE_EMAIL",
  message: "Disposable email addresses are not accepted. Use your own address.",
} as const;

/**
 * The account system. `settings` decides whether this is the hosted demo (ADR-0022): with it off, the instance is
 * exactly what it was before the demo existed. Exported as a factory so a test can build the demo variant.
 */
export function createAuth(settings: DemoSettings) {
  const demo = settings.enabled;
  const secure = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");

  async function onSession(
    session: { userId: string },
    context: { path?: string; query?: unknown; getCookie?: (name: string) => string | null | undefined } | null,
  ) {
    const [account] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1);
    if (!account) return;
    const path = context?.path ?? "";
    const source: LeadSource = path.startsWith("/magic-link") ? "magic-link" : "google";
    const token = (context?.query as { token?: unknown } | undefined)?.token;
    const claim =
      source === "magic-link"
        ? typeof token === "string"
          ? await takeClaim(db, token)
          : null
        : decodeClaim(context?.getCookie?.(DEMO_CLAIM_COOKIE));
    await recordLead(db, { email: account.email, source, claim: claim && { ...claim, name: claim.name ?? account.name } });
    try {
      await provisionSandbox(db, session.userId);
    } catch (error) {
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
              sendMagicLink: async ({ email, url, token }, context) => {
                const claim = claimFromHeaders(
                  context?.headers ?? context?.request?.headers,
                  (context?.body as { name?: string } | undefined)?.name,
                );
                await stashClaim(db, token, claim);
                if (!settings.mailConfigured) {
                  console.log(`demo magic link for ${email}: ${url}`);
                  return;
                }
                const { subject, text } = magicLinkEmail(claim.locale, url);
                await sendEmail("", "", email, subject, text);
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
              if (ctx.path === "/sign-in/magic-link") {
                const email = (ctx.body as { email?: unknown } | undefined)?.email;
                if (typeof email === "string" && isDisposableEmail(email)) throw new APIError("BAD_REQUEST", DISPOSABLE);
              }
              if (ctx.path === "/sign-in/social") {
                const claim = claimFromHeaders(ctx.headers ?? undefined);
                ctx.setCookie(DEMO_CLAIM_COOKIE, encodeClaim(claim), {
                  httpOnly: true,
                  sameSite: "lax",
                  secure,
                  path: "/",
                  maxAge: 60 * 60,
                });
              }
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
