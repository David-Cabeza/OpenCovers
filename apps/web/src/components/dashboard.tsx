import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVenues } from "@/hooks/use-venues";
import { useUiStore } from "@/stores/ui-store";
import { AgendaView } from "./agenda/agenda-view";
import { AvailabilityView } from "./availability/availability-view";
import { FloorView } from "./floor/floor-view";
import { AppHeader } from "./layout/app-header";
import { SetupView } from "./setup/setup-view";
import { EmptyVenues } from "./venue/empty-venues";
import { WaitlistView } from "./waitlist/waitlist-view";

export function Dashboard() {
  const { data: session } = authClient.useSession();
  const { data, isPending } = useVenues();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);

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
    <div className="min-h-dvh">
      <AppHeader email={session?.user.email} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        {isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : venues.length === 0 ? (
          <EmptyVenues />
        ) : venueId ? (
          <Tabs defaultValue="agenda">
            <TabsList>
              <TabsTrigger value="agenda">Agenda</TabsTrigger>
              <TabsTrigger value="floor">Floor</TabsTrigger>
              <TabsTrigger value="availability">Availability</TabsTrigger>
              <TabsTrigger value="waitlist">Waitlist</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
            </TabsList>
            <TabsContent value="agenda" className="pt-6">
              <AgendaView venueId={venueId} />
            </TabsContent>
            <TabsContent value="floor" className="pt-6">
              <FloorView venueId={venueId} />
            </TabsContent>
            <TabsContent value="availability" className="pt-6">
              <AvailabilityView venueId={venueId} />
            </TabsContent>
            <TabsContent value="waitlist" className="pt-6">
              <WaitlistView venueId={venueId} />
            </TabsContent>
            <TabsContent value="setup" className="pt-6">
              <SetupView venueId={venueId} role={role} />
            </TabsContent>
          </Tabs>
        ) : null}
      </main>
    </div>
  );
}
