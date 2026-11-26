import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/error-message";
import { useT, type MessageKey } from "@/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { LoadError } from "@/components/load-error";
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
import { readSectionParam, setSectionParam, subscribeSectionParam } from "@/lib/settings-section";

interface Section {
  id: string;
  label: MessageKey;
  description: MessageKey;
  adminOnly?: boolean;
}

const SECTIONS: Section[] = [
  { id: "venue", label: "setup.section.venue.label", description: "setup.section.venue.description" },
  {
    id: "online",
    label: "setup.section.online.label",
    description: "setup.section.online.description",
    adminOnly: true,
  },
  { id: "room", label: "setup.section.room.label", description: "setup.section.room.description" },
  {
    id: "developers",
    label: "setup.section.developers.label",
    description: "setup.section.developers.description",
    adminOnly: true,
  },
];

const tabId = (id: string) => `settings-tab-${id}`;

function SectionTabs({
  sections,
  active,
  onSelect,
}: {
  sections: Section[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  // The bar scrolls sideways on a narrow screen; keep the active tab in view.
  useEffect(() => {
    refs.current[active]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = sections.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    const id = sections[next].id;
    onSelect(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="sticky top-16 z-[5] -mx-4 border-b bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div role="tablist" aria-label={t("setup.nav")} className="-mx-1 flex gap-2 overflow-x-auto px-1 py-2">
        {sections.map((section, index) => {
          const selected = section.id === active;
          return (
            <button
              key={section.id}
              ref={(el) => {
                refs.current[section.id] = el;
              }}
              id={tabId(section.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-${section.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(section.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm max-sm:min-h-11 coarse:min-h-11 font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(section.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSection({
  section,
  hidden,
  children,
}: {
  section: Section;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section
      id={`settings-${section.id}`}
      role="tabpanel"
      aria-labelledby={tabId(section.id)}
      hidden={hidden}
      className="scroll-mt-32 space-y-4"
    >
      <div>
        <h2 className="font-display text-2xl">{t(section.label)}</h2>
        <p className="text-sm text-muted-foreground">{t(section.description)}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

/**
 * Sections whose cards hold an edited form in local state. They are mounted the first time they are opened and then
 * kept mounted (hidden), so switching tabs never discards unsaved edits. The others (Dining room, Developers) save
 * each change at once through dialogs and mutations, so they are mounted only while open.
 */
const KEEP_MOUNTED = new Set(["venue", "online"]);

export function SetupView({ venueId, role }: { venueId: string; role?: Role }) {
  const t = useT();
  const isAdmin = role === "admin";
  const sections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  const param = useSyncExternalStore(subscribeSectionParam, readSectionParam, () => null);
  const active = sections.find((s) => s.id === param)?.id ?? sections[0].id;

  // Sections opened at least once (the first mount fires their data fetches).
  const [opened, setOpened] = useState<string[]>([active]);
  if (!opened.includes(active)) setOpened([...opened, active]);

  const content = (id: string): React.ReactNode => {
    switch (id) {
      case "venue":
        return (
          <>
            <VenueSettings venueId={venueId} role={role} />
            <BookingPolicyCard venueId={venueId} role={role} />
          </>
        );
      case "online":
        return (
          <>
            <PublicProfileCard venueId={venueId} />
            <OnlineBookingCard venueId={venueId} />
          </>
        );
      case "room":
        return (
          <>
            <TablesSection venueId={venueId} />
            <FloorEditor venueId={venueId} />
            <ServicesSection venueId={venueId} />
          </>
        );
      default:
        return <ApiKeysCard venueId={venueId} />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.title")} description={t("setup.description")} />
      <SectionTabs sections={sections} active={active} onSelect={(id) => setSectionParam(id, "push")} />
      {sections.map((section) => {
        const isActive = section.id === active;
        const mounted = isActive || (KEEP_MOUNTED.has(section.id) && opened.includes(section.id));
        return mounted ? (
          <SettingsSection key={section.id} section={section} hidden={!isActive}>
            {content(section.id)}
          </SettingsSection>
        ) : null;
      })}
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
  const t = useT();
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon" aria-label={t("setup.row.edit", { name: label })} onClick={onEdit}>
        <PencilIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("setup.row.remove", { name: label })} onClick={onRemove}>
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function TablesSection({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useTables(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const [removing, setRemoving] = useState<TableInfo | null>(null);
  const tables = data?.tables ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTable(venueId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(t("setup.tables.removed"));
    },
    onError: (err) => toast.error(errorMessage(err, t("setup.removeFailed"))),
    onSettled: () => setRemoving(null),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4">
        <div>
          <CardTitle as="h3">{t("setup.tables.title")}</CardTitle>
          <CardDescription>{t("setup.tables.description")}</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> {t("setup.tables.add")}
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact what={t("setup.tables.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("setup.tables.empty")}</p>
        ) : (
          <ul className="-my-2 divide-y">
            {tables.map((tb) => (
              <li key={tb.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{tb.name}</div>
                  <div className="text-sm text-muted-foreground">{tb.zone || t("setup.tables.noZone")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="muted">
                    {t("common.seats", { count: tb.seats })}
                  </Pill>
                  <RowActions
                    label={tb.name}
                    onEdit={() => {
                      setEditing(tb);
                      setOpen(true);
                    }}
                    onRemove={() => setRemoving(tb)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        title={removing ? t("setup.tables.confirmTitle", { name: removing.name }) : t("setup.tables.confirmTitleFallback")}
        description={t("setup.tables.confirmDescription")}
        confirmLabel={t("setup.tables.confirmLabel")}
        keepLabel={t("setup.tables.keepLabel")}
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
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useServices(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [removing, setRemoving] = useState<Service | null>(null);
  const services = data?.services ?? [];

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteService(venueId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["services", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(t("setup.services.removed"));
    },
    onError: (err) => toast.error(errorMessage(err, t("setup.removeFailed"))),
    onSettled: () => setRemoving(null),
  });

  return (
    <Card id="settings-services" className="scroll-mt-32">
      <CardHeader className="flex items-center justify-between gap-4">
        <div>
          <CardTitle as="h3">{t("setup.services.title")}</CardTitle>
          <CardDescription>{t("setup.services.description")}</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> {t("setup.services.add")}
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact what={t("setup.services.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("setup.services.empty")}</p>
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
        title={removing ? t("setup.services.confirmTitle", { name: removing.name }) : t("setup.services.confirmTitleFallback")}
        description={t("setup.services.confirmDescription")}
        confirmLabel={t("setup.services.confirmLabel")}
        keepLabel={t("setup.services.keepLabel")}
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
