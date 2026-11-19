import { t } from "@/i18n";

/** "4 guests", or "? guests" when the size of the party is not known. */
export function guestsText(count: number | undefined): string {
  return count === undefined ? t("floor.guestsUnknown") : t("common.guests", { count });
}
