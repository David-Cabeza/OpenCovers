import { t } from "@/i18n";
import type { RemovedMember } from "@/lib/api";

export function removalMessage(revoked: RemovedMember["revoked"] | undefined): string {
  if (!revoked) return t("team.removal.simple");
  const parts = [
    revoked.keys > 0 && t("team.removal.keys", { count: revoked.keys }),
    revoked.sessions > 0 && t("team.removal.sessions", { count: revoked.sessions }),
    revoked.webhooksFlagged > 0 && t("team.removal.webhooks", { count: revoked.webhooksFlagged }),
  ].filter(Boolean);
  return parts.length ? t("team.removal.withParts", { parts: parts.join(", ") }) : t("team.removal.nothing");
}
