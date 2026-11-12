export const CONSENTS = ["unknown", "granted", "denied"] as const;

export type Consent = (typeof CONSENTS)[number];

export function isConsent(value: unknown): value is Consent {
  return typeof value === "string" && (CONSENTS as readonly string[]).includes(value);
}

export function consentColumns(consent: Consent) {
  return {
    consent,
    consentRecordedAt: consent === "unknown" ? null : new Date(),
  };
}
