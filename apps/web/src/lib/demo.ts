import { useEffect, useState } from "react";
import { currentLocale } from "@/i18n";
import { solveInBackground } from "./demo-pow";

// The hosted demo (ADR-0022). A self-hosted instance answers `enabled: false` and the app is what it always was.

/**
 * The consent text version the API accepts (`CONSENT_TEXT_VERSION` in apps/api/src/demo/settings.ts). The wording is
 * `demo.consent.text` in the catalog. Changing either means changing both and the privacy notice.
 */
export const DEMO_CONSENT_VERSION = "v1";
export const DEMO_PRIVACY_URL = "https://opencovers.dev/privacidad.html";
export const DEPLOY_YOURSELF_URL = "https://github.com/David-Cabeza/OpenCovers/blob/main/docs/deploy.md";

export interface DemoStatus {
  enabled: boolean;
  googleEnabled: boolean;
  venueId?: string;
  bookingKey?: string | null;
  expiresAt?: string;
}

const OFF: DemoStatus = { enabled: false, googleEnabled: false };

/** Anything but a clear answer counts as "not a demo", so a failure never hides the normal sign-in. */
export async function fetchDemoStatus(): Promise<DemoStatus> {
  try {
    const res = await fetch("/api/demo/status", { credentials: "same-origin" });
    if (!res.ok) return OFF;
    const body = (await res.json()) as Partial<DemoStatus>;
    return body.enabled === true ? { ...OFF, ...body, enabled: true } : OFF;
  } catch {
    return OFF;
  }
}

/** `null` while the first answer is on its way. */
export function useDemoStatus(): DemoStatus | null {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  useEffect(() => {
    let live = true;
    void fetchDemoStatus().then((next) => live && setStatus(next));
    return () => {
      live = false;
    };
  }, []);
  return status;
}

export interface MagicLinkChallenge {
  challenge: { nonce: string; issuedAt: number; difficulty: number; signature: string };
  expiresAt: string;
}

/** A refusal in the shape Better Auth gives one, so the form reads both the same way. */
export class DemoRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly retryAfter: number,
  ) {
    super(code ?? String(status));
  }
}

/** A fresh challenge for this address. One is good for one request and 5 minutes, so every send asks for its own. */
export async function fetchMagicLinkChallenge(email: string): Promise<MagicLinkChallenge> {
  const res = await fetch("/api/demo/magic-link-challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new DemoRequestError(res.status, body?.code, Number(res.headers.get("retry-after")) || 0);
  }
  return (await res.json()) as MagicLinkChallenge;
}

/** Fetches a challenge for `email` and solves it. The headers the magic-link request carries (deploy.md, Hosted demo). */
export async function solvedChallengeHeaders(email: string): Promise<Record<string, string>> {
  const { challenge } = await fetchMagicLinkChallenge(email);
  const solution = await solveInBackground(challenge);
  return { "X-Demo-Challenge": JSON.stringify(challenge), "X-Demo-Solution": solution };
}

const CONSENT_KEY = "oc-demo-consent";

/**
 * The consent box is ticked before sign-in, and the API records consent only from a signed-in session (ADR-0022,
 * amendment of 2026-11-20). So the tick waits in this browser until the dashboard sends it. The magic link may open
 * in a new tab, hence localStorage.
 */
export function rememberConsent(consented: boolean): void {
  try {
    if (consented) window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: DEMO_CONSENT_VERSION }));
    else window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage can be blocked. Consent is then not recorded, which is the safe side.
  }
}

/** Sends a remembered consent once, with the session cookie. Forgets it on an answer, keeps it if the network failed. */
export async function sendPendingConsent(): Promise<void> {
  let pending: string | null = null;
  try {
    pending = window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return;
  }
  if (!pending) return;
  try {
    const { version } = JSON.parse(pending) as { version?: string };
    const res = await fetch("/api/demo/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, locale: currentLocale() }),
    });
    if (res.status === 401) return; // not signed in yet
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Offline: try again on the next visit.
  }
}

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "long", year: "numeric" });
}
