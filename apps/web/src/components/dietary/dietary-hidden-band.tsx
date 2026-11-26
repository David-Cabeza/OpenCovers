import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useVenueConfig } from "@/hooks/use-venue-config";
import { useT } from "@/i18n";

/**
 * Says that the server holds allergies or diets it is not returning (C82), so a clean screen is not read as nobody
 * having one. It shows only on `true`: `false` or an absent field says nothing about the guests.
 */
export function DietaryHiddenBand({ venueId, onService }: { venueId: string | null; onService: boolean }) {
  const t = useT();
  const { data } = useVenueConfig(venueId, { watch: onService });
  const hidden = data?.dietaryValuesHidden === true;

  // When the warning goes, the agenda in memory may have been read without the values, so it is asked for again.
  const queryClient = useQueryClient();
  const hiddenIn = useRef<string | null>(null);
  useEffect(() => {
    if (hidden) hiddenIn.current = venueId;
    else if (data && hiddenIn.current === venueId) {
      hiddenIn.current = null;
      void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
    }
  }, [hidden, data, venueId, queryClient]);

  return (
    <>
      {/* Mounted whatever the screen, so it is read out when it starts and not again on each change of screen. */}
      <p role="alert" className="sr-only print:hidden">
        {hidden ? `${t("dietary.hidden.title")} ${t("dietary.hidden.action")}` : ""}
      </p>
      {hidden && onService && (
        <div
          role="region"
          aria-label={t("dietary.title")}
          data-slot="dietary-hidden"
          className="flex items-start gap-2 border-b-2 border-destructive bg-danger-soft px-4 py-2 text-sm leading-snug sm:sticky sm:top-16 sm:z-[5] sm:px-6 lg:px-8 print:static print:mb-3 print:border-2 print:border-black print:bg-white print:px-3 print:text-black"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive print:text-black" aria-hidden="true" />
          <p className="min-w-0">
            <strong>{t("dietary.hidden.title")}</strong> {t("dietary.hidden.action")}
          </p>
        </div>
      )}
    </>
  );
}
