import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenues } from "@/hooks/use-venues";
import { useUiStore } from "@/stores/ui-store";
import { AgendaView } from "./agenda/agenda-view";
import { AvailabilityView } from "./availability/availability-view";
import { FloorView } from "./floor/floor-view";
import { Sidebar, type ViewId } from "./layout/sidebar";
import { Topbar } from "./layout/topbar";
import { PacingView } from "./pacing/pacing-view";
import { SetupView } from "./setup/setup-view";
import { EmptyVenues } from "./venue/empty-venues";
import { WaitlistView } from "./waitlist/waitlist-view";

export function Dashboard() {
  const { data: session } = authClient.useSession();
  const { data, isPending } = useVenues();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const [active, setActive] = useState<ViewId>("agenda");

  const venues = data?.venues ?? [];
  const role = venues.find((v) => v.id === venueId)?.role;

  useEffect(() => {
    if (
      venues.length > 0 &&
      (!venueId || !venues.some((v) => v.id === venueId))
    ) {
      setVenue(venues[0].id);
    }
  }, [venues, venueId, setVenue]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar active={active} onSelect={setActive} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={session?.user.email} />
        <main className="flex-1 p-6 lg:p-8">
          {isPending ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : venues.length === 0 ? (
            <EmptyVenues />
          ) : venueId ? (
            <>
              {active === "agenda" && <AgendaView venueId={venueId} />}
              {active === "floor" && <FloorView venueId={venueId} />}
              {active === "availability" && <AvailabilityView venueId={venueId} />}
              {active === "waitlist" && <WaitlistView venueId={venueId} />}
              {active === "pacing" && <PacingView venueId={venueId} />}
              {active === "setup" && <SetupView venueId={venueId} role={role} />}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
