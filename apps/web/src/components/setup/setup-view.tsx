import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { PageHeader } from "@/components/layout/page-header";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { api, type Service, type Table as TableInfo } from "@/lib/api";
import { formatDays } from "@/lib/weekdays";
import { ServiceFormDialog } from "./service-form-dialog";
import { TableFormDialog } from "./table-form-dialog";
import { VenueSettings } from "./venue-settings";
import { BookingPolicyCard } from "./booking-policy-card";
import { PublicProfileCard } from "./public-profile-card";
import { OnlineBookingCard } from "./online-booking-card";
import { ApiKeysCard } from "./api-keys-card";
import { FloorEditor } from "./floor-editor";
import type { Role } from "@/lib/api";

interface Section {
  id: string;
  label: string;
  description: string;
  adminOnly?: boolean;
}

const SECTIONS: Section[] = [
  { id: "venue", label: "General", description: "Name, hours and how bookings are accepted." },
  {
    id: "online",
    label: "Online",
    description: "Your public page and the widget guests use to book.",
    adminOnly: true,
  },
  { id: "room", label: "Dining room", description: "Tables, the floor plan and your services." },
  {
    id: "developers",
    label: "Developers",
    description: "API keys for integrations and agents.",
    adminOnly: true,
  },
];

function SectionNav({ sections }: { sections: Section[] }) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-16 z-[5] -mx-4 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() =>
            document.getElementById(`settings-${section.id}`)?.scrollIntoView?.({ behavior: "smooth" })
          }
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function SettingsSection({
  section,
  children,
}: {
  section: Section;
  children: React.ReactNode;
}) {
  return (
    <section id={`settings-${section.id}`} aria-labelledby={`settings-${section.id}-title`} className="scroll-mt-32 space-y-4">
      <div>
        <h3 id={`settings-${section.id}-title`} className="font-display text-2xl">
          {section.label}
        </h3>
        <p className="text-sm text-muted-foreground">{section.description}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function SetupView({ venueId, role }: { venueId: string; role?: Role }) {
  const isAdmin = role === "admin";
  const sections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  const section = (id: string) => SECTIONS.find((s) => s.id === id) as Section;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Everything that shapes how this venue takes bookings." />
      <SectionNav sections={sections} />
      <div className="space-y-12">
        <SettingsSection section={section("venue")}>
          <VenueSettings venueId={venueId} role={role} />
          <BookingPolicyCard venueId={venueId} role={role} />
        </SettingsSection>
        {isAdmin && (
          <SettingsSection section={section("online")}>
            <PublicProfileCard venueId={venueId} />
            <OnlineBookingCard venueId={venueId} />
          </SettingsSection>
        )}
        <SettingsSection section={section("room")}>
          <TablesSection venueId={venueId} />
          <FloorEditor venueId={venueId} />
          <ServicesSection venueId={venueId} />
        </SettingsSection>
        {isAdmin && (
          <SettingsSection section={section("developers")}>
            <ApiKeysCard venueId={venueId} />
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

function RowActions({
  label,
  onEdit,
  onRemove,
}: {
  label: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon" aria-label={`Edit ${label}`} onClick={onEdit}>
        <PencilIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function TablesSection({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useTables(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const [removing, setRemoving] = useState<TableInfo | null>(null);
  const tables = data?.tables ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTable(venueId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Table removed");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not remove.")),
    onSettled: () => setRemoving(null),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4">
        <div>
          <CardTitle>Tables</CardTitle>
          <CardDescription>Seating for each table and its zone.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> Add table
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tables yet.</p>
        ) : (
          <ul className="-my-2 divide-y">
            {tables.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">{t.zone || "No zone"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="muted">
                    {t.seats} {t.seats === 1 ? "seat" : "seats"}
                  </Pill>
                  <RowActions
                    label={t.name}
                    onEdit={() => {
                      setEditing(t);
                      setOpen(true);
                    }}
                    onRemove={() => setRemoving(t)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name}?` : "Remove table?"}
        description="It leaves the floor plan and the availability, and this cannot be undone."
        confirmLabel="Remove table"
        keepLabel="Keep table"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
      <TableFormDialog
        venueId={venueId}
        open={open}
        onOpenChange={setOpen}
        initial={editing}
      />
    </Card>
  );
}

function ServicesSection({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useServices(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [removing, setRemoving] = useState<Service | null>(null);
  const services = data?.services ?? [];

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteService(venueId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["services", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Service removed");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not remove.")),
    onSettled: () => setRemoving(null),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4">
        <div>
          <CardTitle>Services</CardTitle>
          <CardDescription>Your meal periods and their hours.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> Add service
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : services.length === 0 ? (
          <p className="text-sm text-muted-foreground">No services yet.</p>
        ) : (
          <ul className="-my-2 divide-y">
            {services.map((sv) => (
              <li key={sv.name} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium first-letter:uppercase">{sv.name}</div>
                  <div className="text-sm text-muted-foreground">{formatDays(sv.days)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="info">
                    {sv.openStart}–{sv.openEnd}
                  </Pill>
                  <RowActions
                    label={sv.name}
                    onEdit={() => {
                      setEditing(sv);
                      setOpen(true);
                    }}
                    onRemove={() => setRemoving(sv)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name}?` : "Remove service?"}
        description="Its hours stop applying to availability and bookings, and this cannot be undone."
        confirmLabel="Remove service"
        keepLabel="Keep service"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.name)}
        onClose={() => setRemoving(null)}
      />
      <ServiceFormDialog
        venueId={venueId}
        open={open}
        onOpenChange={setOpen}
        initial={editing}
      />
    </Card>
  );
}
