import type { RemovedMember } from "@/lib/api";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function removalMessage(revoked: RemovedMember["revoked"] | undefined): string {
  if (!revoked) return "Member removed";
  const parts = [
    revoked.keys > 0 && `${count(revoked.keys, "API key", "API keys")} revoked`,
    revoked.sessions > 0 && `${count(revoked.sessions, "session", "sessions")} ended`,
    revoked.webhooksFlagged > 0 &&
      `${count(revoked.webhooksFlagged, "webhook", "webhooks")} flagged for review`,
  ].filter(Boolean);
  return parts.length
    ? `Member removed. ${parts.join(", ")}.`
    : "Member removed. Nothing else to revoke.";
}
