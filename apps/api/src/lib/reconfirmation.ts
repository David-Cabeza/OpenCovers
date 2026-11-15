export const RECONFIRMATIONS = ["none", "requested", "confirmed", "declined", "no_answer"] as const;

export type Reconfirmation = (typeof RECONFIRMATIONS)[number];

export function isReconfirmation(value: unknown): value is Reconfirmation {
  return typeof value === "string" && (RECONFIRMATIONS as readonly string[]).includes(value);
}

export function reconfirmationColumns(reconfirmation: Reconfirmation) {
  return {
    reconfirmation,
    reconfirmationRecordedAt: reconfirmation === "none" ? null : new Date(),
  };
}
