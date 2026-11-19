import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ServerBanner } from "@/components/server-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenues } from "@/hooks/use-venues";
import { useUiStore } from "@/stores/ui-store";
import { AgendaView } from "./agenda/agenda-view";
import { AvailabilityView } from "./availability/availability-view";
import { FloorView } from "./floor/floor-view";
import { MobileNav, Sidebar, type ViewId } from "./layout/sidebar";
import { Topbar } from "./layout/topbar";
import { PacingView } from "./pacing/pacing-view";
import { PreShiftView } from "./preshift/pre-shift-view";
import { SetupView } from "./setup/setup-view";
import { TeamView } from "./team/team-view";
import { EmptyVenues } from "./venue/empty-venues";
import { WaitlistView } from "./waitlist/waitlist-view";

export function Dashboard() {
  const { data: session } = authClient.useSession();
  const { data, isPending } = useVenues();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const [active, setActive] = useState<ViewId>("agenda");
  const [navOpen, setNavOpen] = useState(false);

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
      <Sidebar active={active} onSelect={setActive} role={role} />
      <MobileNav
        open={navOpen}
        onOpenChange={setNavOpen}
        active={active}
        onSelect={setActive}
        role={role}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ServerBanner />
        <Topbar email={session?.user.email} onMenu={() => setNavOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 print:p-0">
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
              {active === "preshift" && <PreShiftView venueId={venueId} />}
              {active === "floor" && <FloorView venueId={venueId} />}
              {active === "availability" && <AvailabilityView venueId={venueId} />}
              {active === "waitlist" && <WaitlistView venueId={venueId} />}
              {active === "pacing" && <PacingView venueId={venueId} />}
              {active === "team" && role === "admin" && <TeamView venueId={venueId} />}
              {active === "setup" && <SetupView venueId={venueId} role={role} />}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
