import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { shiftIso, todayIso } from "@/lib/date";
import { useDayParam } from "@/lib/day-param";
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
    <div role="region" aria-label={t("demo.bar.label")} className="print:hidden border-b border-primary/30 bg-primary/10 text-sm max-lg:text-xs">
      <Checklist
        venueId={venueId}
        lead={
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
        }
        switcher={<ViewSwitch bookingKey={bookingKey ?? null} widgetOrigin={widgetOrigin ?? null} />}
      />
    </div>
  );
}

function ViewSwitch({ bookingKey, widgetOrigin }: { bookingKey: string | null; widgetOrigin: string | null }) {
  const t = useT();
  const { resolvedTheme } = useTheme();
  const base = "inline-flex h-7 coarse:h-11 items-center gap-1.5 px-3 text-sm font-medium";
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

type StepId = "book" | "agenda" | "cancel" | "rule";

/** Steps the app cannot read from anywhere, so the visitor ticks them. */
const MANUAL: StepId[] = ["agenda", "rule"];

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

const FOLD_PREFIX = "oc-demo-folded:";

/** The visitor's own choice for this sandbox, or null when they have not made one. */
function readFolded(venueId: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(FOLD_PREFIX + venueId);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeFolded(venueId: string, folded: boolean) {
  try {
    window.localStorage.setItem(FOLD_PREFIX + venueId, folded ? "1" : "0");
  } catch {
    // Storage can be blocked. The fold then lasts until the page reloads.
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
 * Booking and cancelling are read from the bookings the guest widget made. "Find it in the agenda and open its trace"
 * and "try the double booking" cannot be read from anywhere, so the visitor ticks them. The seed marks tomorrow at
 * 21:00 as full (`fullService` in the demo template), and the last step names that time.
 */
function Checklist({ venueId, lead, switcher }: { venueId: string; lead: React.ReactNode; switcher: React.ReactNode }) {
  const t = useT();
  // The visitor's choice wins and is remembered per sandbox. Without one the tour is open on a wide screen (on a
  // phone it would take half of it, so it starts folded) and folds itself once every step is done.
  const [folded, setFolded] = useState<boolean | null>(() => readFolded(venueId));
  const [wide] = useState(() => window.matchMedia?.("(min-width: 640px)").matches ?? true);
  const [ticked, setTicked] = useState<StepId[]>(() => readTicked(venueId));
  const nav = useNavigation();
  const [, setDay] = useDayParam();
  useEffect(() => {
    setTicked(readTicked(venueId));
    setFolded(readFolded(venueId));
  }, [venueId]);

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
  // The visitor may have booked another day, so the agenda and the floor plan open on their latest booking that is
  // still on (the widget keeps no creation time, so "latest" is the last date and time), or today without one.
  const live = widget.filter((r) => r.status !== "cancelled");
  const mine = [...(live.length > 0 ? live : widget)]
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .at(-1);
  const mineDay = mine?.date ?? todayIso();

  const done: Record<StepId, boolean> = {
    book: booked,
    agenda: ticked.includes("agenda"),
    cancel: cancelled,
    rule: ticked.includes("rule"),
  };

  function toggle(id: StepId) {
    const next = ticked.includes(id) ? ticked.filter((s) => s !== id) : [...ticked, id];
    setTicked(next);
    writeTicked(venueId, next);
  }

  const openButton = (label: string, day: string) => (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="max-sm:h-9 max-sm:px-3 coarse:h-11"
      onClick={() => {
        void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
        setDay(day);
        nav?.goTo("agenda");
      }}
    >
      {label}
    </Button>
  );
  const manual = (id: StepId, opener: React.ReactNode) => (
    <span className="flex flex-wrap gap-2">
      {opener}
      <Button type="button" size="xs" variant="ghost" className="max-sm:h-9 max-sm:px-3 coarse:h-11" onClick={() => toggle(id)}>
        {done[id] ? t("demo.tour.untick") : t("demo.tour.markDone")}
      </Button>
    </span>
  );

  const steps: { id: StepId; text: string; action?: React.ReactNode }[] = [
    { id: "book", text: t("demo.tour.book") },
    { id: "agenda", text: t("demo.tour.agenda"), action: manual("agenda", openButton(t("demo.tour.openAgenda"), mineDay)) },
    { id: "cancel", text: t("demo.tour.cancel") },
    { id: "rule", text: t("demo.tour.rule"), action: manual("rule", openButton(t("demo.tour.openTomorrow"), shiftIso(todayIso(), 1))) },
  ];
  const count = Object.values(done).filter(Boolean).length;
  // Below 1024 px only the first step left shows (the count in the title says where the visitor is), so the tour
  // leaves room for the app.
  const current = (steps.find((step) => !done[step.id]) ?? steps[steps.length - 1]!).id;
  const open = folded === null ? wide && count < steps.length : !folded;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 pb-1 pt-1.5 sm:px-6">
        {/* An open tour takes the lead's room on a phone. Folding the tour brings it back. */}
        <div className={cn(open && "max-sm:hidden")}>{lead}</div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:w-full max-sm:justify-between max-sm:gap-x-2">
          {switcher}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? "demo-checklist" : undefined}
            onClick={() => {
              setFolded(open);
              writeFolded(venueId, open);
            }}
            className="flex items-center gap-2 py-1 coarse:min-h-11 text-sm font-medium"
          >
            <ChevronDownIcon className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
            <span className="max-sm:hidden">{t("demo.tour.title", { done: count, total: steps.length })}</span>
            <span className="sm:hidden">{t("demo.tour.short", { done: count, total: steps.length })}</span>
          </button>
        </div>
      </div>
      {open && (
        <ol id="demo-checklist" className="space-y-1.5 border-t border-primary/20 px-4 pb-2 pt-1.5 sm:px-6">
          {steps.map((step) => (
            <li key={step.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", step.id !== current && "max-lg:hidden")}>
              <span className="inline-flex items-start gap-2">
                {done[step.id] ? (
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className={cn(done[step.id] && "text-foreground/70 line-through")}>
                  {step.text}
                  <span className="sr-only">{" "}{done[step.id] ? t("demo.tour.done") : t("demo.tour.notDone")}</span>
                </span>
              </span>
              {step.action && <span>{step.action}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
