import { useEffect, useState } from "react";

// The hosted demo (ADR-0022). A self-hosted instance answers `enabled: false` and the app is what it always was.

/**
 * PLACEHOLDER consent wording, pending legal review (ADR-0022, "Open for the owner"). The version string is what the
 * API stores with a lead, so replacing the text means bumping it.
 */
export const DEMO_CONSENT_VERSION = "demo-consent-v0-placeholder";
export const DEMO_CONSENT_TEXT = "I agree to receive news about OpenCovers.";
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

/** The language the magic-link email and the stored lead use. The API understands es and en. */
export function demoLocale(): string {
  const lang = typeof navigator === "undefined" ? "en" : navigator.language;
  return lang.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Headers for a demo sign-in request. Consent is sent only when the box is ticked. */
export function demoSignInHeaders(consented: boolean): Record<string, string> {
  return {
    "X-Demo-Locale": demoLocale(),
    ...(consented ? { "X-Demo-Consent": DEMO_CONSENT_VERSION } : {}),
  };
}

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
