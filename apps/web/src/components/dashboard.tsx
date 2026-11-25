import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { LoadError } from "@/components/load-error";
import { useDemoStatus } from "@/lib/demo";
import { DemoBar } from "./demo/demo-bar";
import { ServerBanner } from "@/components/server-banner";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { useVenues } from "@/hooks/use-venues";
import { useT } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";
import { readSectionParam, sectionForTarget, setSectionParam } from "@/lib/settings-section";
import { readViewParam, setViewParam, visibleView } from "@/lib/view-param";
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
  const t = useT();
  const { data: session } = authClient.useSession();
  const { data, isPending, isError, error, isRefetching, refetch } = useVenues();
  const demo = useDemoStatus();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const [active, setActive] = useState<ViewId>(() => (readSectionParam() ? "setup" : (readViewParam() ?? "agenda")));
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

  // A screen the role cannot see (a reader opening `?view=team`) falls back to the agenda once the role is known.
  useEffect(() => {
    if (role) setActive((view) => visibleView(view, role));
  }, [role]);

  // The screen is part of the address, so a reload (F5) comes back to it. `?section=` already implies Settings.
  useEffect(() => {
    setViewParam(active === "setup" && readSectionParam() ? null : active);
  }, [active]);

  const goTo = useCallback((view: ViewId, to?: string) => {
    setActive(view);
    setSection(to ?? null);
    // Open the Settings section that holds the target; it is scrolled to once drawn.
    const target = to ? sectionForTarget(to) : undefined;
    if (view === "setup" && target) setSectionParam(target, "push");
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
  }, [active, venueName, t]);

  // The section is part of the address only while Settings is open.
  useEffect(() => {
    if (active !== "setup" && readSectionParam()) setSectionParam(null);
  }, [active]);

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
          {t("layout.skipToContent")}
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
              <Loading className="space-y-4">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-64 w-full" />
              </Loading>
            ) : isError && !data ? (
              <LoadError title={t("layout.dashboard.loadVenues")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
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
