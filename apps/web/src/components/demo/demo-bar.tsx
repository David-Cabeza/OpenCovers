import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { shiftIso, todayIso } from "@/lib/date";
import { useT } from "@/i18n";
import { DEPLOY_YOURSELF_URL, dinerLink, formatExpiry, type DemoStatus } from "@/lib/demo";
import { cn } from "cn";
import { useTheme } from "@/lib/theme";
import { useNavigation } from "@/components/layout/navigation";

/** The fixed bar of a demo sandbox (ADR-0022, decisions 2, 3 and 9): expiry, the Restaurant | Diner switch, the tour. */
export function DemoBar({ status }: { status: DemoStatus }) {
  const t = useT();
  const { venueId, bookingKey, expiresAt, widgetOrigin } = status;
  if (!venueId) return null;
  return (
    <div role="region" aria-label={t("demo.bar.label")} className="print:hidden border-b border-primary/30 bg-primary/10 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <p>
          <strong className="font-medium">{t("demo.bar.title")}</strong> {t("demo.bar.sandbox")}
          {expiresAt && <> {t("demo.bar.expires", { date: formatExpiry(expiresAt) })}</>}{" "}
          <a
            href={DEPLOY_YOURSELF_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {t("demo.bar.deploy")}
          </a>
        </p>
        <ViewSwitch bookingKey={bookingKey ?? null} widgetOrigin={widgetOrigin ?? null} />
      </div>
      <Checklist venueId={venueId} />
    </div>
  );
}

function ViewSwitch({ bookingKey, widgetOrigin }: { bookingKey: string | null; widgetOrigin: string | null }) {
  const t = useT();
  const { resolvedTheme } = useTheme();
  const base = "inline-flex h-8 items-center gap-1.5 px-3 text-sm font-medium";
  return (
    <div role="group" aria-label={t("demo.bar.view")} className="inline-flex overflow-hidden rounded-md border bg-background">
      <span aria-current="true" className={cn(base, "bg-primary text-primary-foreground")}>
        {t("demo.bar.restaurant")}
      </span>
      {bookingKey ? (
        <a
          href={dinerLink(bookingKey, widgetOrigin, resolvedTheme)}
          target="_blank"
          rel="noreferrer"
          className={cn(base, "hover:bg-accent")}
        >
          {t("demo.bar.diner")}
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{t("demo.bar.dinerNewTab")}</span>
        </a>
      ) : (
        <span className={cn(base, "opacity-50")}>{t("demo.bar.diner")}</span>
      )}
    </div>
  );
}

type StepId = "book" | "agenda" | "trace" | "cancel";

/** Steps the app cannot read from anywhere, so the visitor ticks them. */
const MANUAL: StepId[] = ["agenda", "trace"];

const STORAGE_PREFIX = "oc-demo-checklist:";

function readTicked(venueId: string): StepId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + venueId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((s): s is StepId => MANUAL.includes(s as StepId))) : [];
  } catch {
    return [];
  }
}

function writeTicked(venueId: string, ticked: StepId[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + venueId, JSON.stringify(ticked));
  } catch {
    // Storage can be blocked. The tick then lasts until the page reloads.
  }
}

/**
 * Booking and cancelling are read from the bookings the guest widget made. "Find it in the agenda" and "open its
 * trace" (the agenda row's menu) cannot be read from anywhere, so the visitor ticks them.
 */
function Checklist({ venueId }: { venueId: string }) {
  const t = useT();
  // Open on a wide screen; on a phone the tour would take half of it, so it starts folded.
  const [open, setOpen] = useState(() => window.matchMedia?.("(min-width: 640px)").matches ?? true);
  const [ticked, setTicked] = useState<StepId[]>(() => readTicked(venueId));
  const nav = useNavigation();
  useEffect(() => setTicked(readTicked(venueId)), [venueId]);

  // The diner books in another tab, so look again when this one comes back into focus and every few seconds.
  const { data } = useQuery({
    queryKey: ["demo-widget-bookings", venueId],
    queryFn: () => {
      const today = todayIso();
      return api.searchReservations(venueId, shiftIso(today, -1), shiftIso(today, 180));
    },
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const widget = (data?.reservations ?? []).filter((r) => r.bookedVia === "widget");
  const booked = widget.length > 0;

  // The diner books in another tab, so the agenda this tab already loaded is out of date. Look again when a booking
  // arrives that this tab had not seen, and when the visitor asks for the agenda.
  const queryClient = useQueryClient();
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (data === undefined) return;
    if (seen.current !== null && widget.length > seen.current) {
      void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
    }
    seen.current = widget.length;
  }, [data, widget.length, venueId, queryClient]);
  const cancelled = widget.some((r) => r.status === "cancelled");

  const done: Record<StepId, boolean> = {
    book: booked,
    agenda: ticked.includes("agenda"),
    trace: ticked.includes("trace"),
    cancel: cancelled,
  };

  function toggle(id: StepId) {
    const next = ticked.includes(id) ? ticked.filter((s) => s !== id) : [...ticked, id];
    setTicked(next);
    writeTicked(venueId, next);
  }

  const manual = (id: StepId, openAgenda: boolean) => (
    <span className="flex flex-wrap gap-2">
      {openAgenda && (
        <Button type="button" size="xs" variant="outline" className="max-sm:h-9 max-sm:px-3" onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
            nav?.goTo("agenda");
          }}>
          {t("demo.tour.openAgenda")}
        </Button>
      )}
      <Button type="button" size="xs" variant="ghost" className="max-sm:h-9 max-sm:px-3" onClick={() => toggle(id)}>
        {done[id] ? t("demo.tour.untick") : t("demo.tour.markDone")}
      </Button>
    </span>
  );

  const steps: { id: StepId; text: string; action?: React.ReactNode }[] = [
    { id: "book", text: t("demo.tour.book") },
    { id: "agenda", text: t("demo.tour.agenda"), action: manual("agenda", true) },
    { id: "trace", text: t("demo.tour.trace"), action: manual("trace", false) },
    { id: "cancel", text: t("demo.tour.cancel") },
  ];
  const count = Object.values(done).filter(Boolean).length;

  return (
    <div className="border-t border-primary/20 px-4 py-1.5 sm:px-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "demo-checklist" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-1 text-sm font-medium"
      >
        <ChevronDownIcon className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
        {t("demo.tour.title", { done: count, total: steps.length })}
      </button>
      {open && (
        <ol id="demo-checklist" className="space-y-1.5 pb-2 pl-6">
          {steps.map((step) => (
            <li key={step.id} className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3">
              {done[step.id] ? (
                <CheckCircle2Icon className="size-4 text-primary" aria-hidden="true" />
              ) : (
                <CircleIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={cn(done[step.id] && "text-muted-foreground line-through")}>
                {step.text}
                <span className="sr-only">{" "}{done[step.id] ? t("demo.tour.done") : t("demo.tour.notDone")}</span>
              </span>
              {step.action && <span className="col-start-2 sm:col-auto">{step.action}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
