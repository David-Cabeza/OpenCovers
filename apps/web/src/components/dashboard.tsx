import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { LoadError } from "@/components/load-error";
import { useDemoStatus } from "@/lib/demo";
import { DemoBar } from "./demo/demo-bar";
import { ServerBanner } from "@/components/server-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenues } from "@/hooks/use-venues";
import { useUiStore } from "@/stores/ui-store";
import { AgendaView } from "./agenda/agenda-view";
import { AvailabilityView } from "./availability/availability-view";
import { FloorView } from "./floor/floor-view";
import { NavigationProvider, useScrollToSection } from "./layout/navigation";
import { MobileNav, Sidebar, viewLabel, type ViewId } from "./layout/sidebar";
import { Topbar } from "./layout/topbar";
import { PacingView } from "./pacing/pacing-view";
import { PreShiftView } from "./preshift/pre-shift-view";
import { SetupView } from "./setup/setup-view";
import { TeamView } from "./team/team-view";
import { EmptyVenues } from "./venue/empty-venues";
import { WaitlistView } from "./waitlist/waitlist-view";

export function Dashboard() {
  const { data: session } = authClient.useSession();
  const { data, isPending, isError, error, isRefetching, refetch } = useVenues();
  const demo = useDemoStatus();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const [active, setActive] = useState<ViewId>("agenda");
  const [navOpen, setNavOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);

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

  const goTo = useCallback((view: ViewId, to?: string) => {
    setActive(view);
    setSection(to ?? null);
  }, []);
  const navigation = useMemo(() => ({ goTo, role }), [goTo, role]);

  const sectionDone = useCallback(() => setSection(null), []);
  useScrollToSection(section, sectionDone);

  // The tab says which screen and which venue it is, and a screen reader hears it when the page changes.
  const venueName = venues.find((v) => v.id === venueId)?.name;
  useEffect(() => {
    document.title = [viewLabel(active), venueName, "OpenCovers"].filter(Boolean).join(" · ");
    return () => {
      document.title = "OpenCovers";
    };
  }, [active, venueName]);

  const mainRef = useRef<HTMLElement>(null);

  return (
    <NavigationProvider value={navigation}>
      <div className="flex min-h-dvh">
        <a
          href="#main-content"
          onClick={(e) => {
            // A link to a fragment would change the address, which the invitation link also uses.
            e.preventDefault();
            mainRef.current?.focus();
          }}
          className="sr-only z-50 rounded-md bg-primary text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
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
          {demo?.enabled && <DemoBar status={demo} />}
          <Topbar email={session?.user.email} onMenu={() => setNavOpen(true)} />
          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            className="flex-1 p-4 outline-none sm:p-6 lg:p-8 print:p-0"
          >
            {isPending ? (
              <div className="space-y-4">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : isError && !data ? (
              <LoadError what="your venues" error={error} retrying={isRefetching} onRetry={() => void refetch()} />
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
    </NavigationProvider>
  );
}
