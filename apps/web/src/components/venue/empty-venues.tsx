import { CalendarDaysIcon } from "lucide-react";
import { CreateVenueDialog } from "./create-venue-dialog";

export function EmptyVenues() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <CalendarDaysIcon className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">No venues yet</h2>
        <p className="text-sm text-muted-foreground">
          Create your first venue to start taking reservations.
        </p>
      </div>
      <CreateVenueDialog triggerLabel="Create your first venue" />
    </div>
  );
}
