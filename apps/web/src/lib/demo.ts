import { useEffect, useState } from "react";
import { currentLocale } from "@/i18n";
import { solveInBackground } from "./demo-pow";

// The hosted demo (ADR-0022). A self-hosted instance answers `enabled: false` and the app is what it always was.

export const DEMO_TERMS_URL = "https://opencovers.dev/condiciones.html";
export const DEMO_PRIVACY_URL = "https://opencovers.dev/privacidad.html";
export const DEPLOY_YOURSELF_URL = "https://github.com/David-Cabeza/OpenCovers/blob/main/docs/deploy.md";

export interface DemoStatus {
  enabled: boolean;
  googleEnabled: boolean;
  venueId?: string;
  bookingKey?: string | null;
  expiresAt?: string;
  /** The widget's own origin in production; absent in development, where `/w/` goes through the dev proxy. */
  widgetOrigin?: string;
}

/** The guest widget link. The staff host answers 404 on `/w/*`, so with a widget origin the link is absolute. */
export function dinerLink(bookingKey: string, widgetOrigin?: string | null): string {
  return `${widgetOrigin ? widgetOrigin.replace(/\/+$/, "") : ""}/w/${bookingKey}`;
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

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "long", year: "numeric" });
}
