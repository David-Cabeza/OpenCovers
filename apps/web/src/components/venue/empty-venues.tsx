import { CalendarDaysIcon } from "lucide-react";
import { useT } from "@/i18n";
import { CreateVenueDialog } from "./create-venue-dialog";

export function EmptyVenues() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <CalendarDaysIcon className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t("venue.empty.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("venue.empty.description")}
        </p>
      </div>
      <CreateVenueDialog triggerLabel={t("venue.empty.cta")} />
    </div>
  );
}
