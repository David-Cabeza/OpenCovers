import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { shiftIso, todayIso } from "@/lib/date";
import { DEPLOY_YOURSELF_URL, formatExpiry, type DemoStatus } from "@/lib/demo";
import { cn } from "cn";
import { useNavigation } from "@/components/layout/navigation";

/** The fixed bar of a demo sandbox (ADR-0022, decisions 2, 3 and 9): expiry, the Restaurant | Diner switch, the tour. */
export function DemoBar({ status }: { status: DemoStatus }) {
  const { venueId, bookingKey, expiresAt } = status;
  if (!venueId) return null;
  return (
    <div className="print:hidden border-b border-primary/30 bg-primary/10 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <p>
          <strong className="font-medium">Demo.</strong> This is your own sandbox restaurant.
          {expiresAt && <> It is deleted on {formatExpiry(expiresAt)}.</>}{" "}
          <a
            href={DEPLOY_YOURSELF_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Deploy it yourself
          </a>
        </p>
        <ViewSwitch bookingKey={bookingKey ?? null} />
      </div>
      <Checklist venueId={venueId} />
    </div>
  );
}

function ViewSwitch({ bookingKey }: { bookingKey: string | null }) {
  const base = "inline-flex h-8 items-center gap-1.5 px-3 text-sm font-medium";
  return (
    <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-md border bg-background">
      <span aria-current="true" className={cn(base, "bg-primary text-primary-foreground")}>
        Restaurant
      </span>
      {bookingKey ? (
        <a
          href={`/w/${bookingKey}`}
          target="_blank"
          rel="noreferrer"
          className={cn(base, "hover:bg-accent")}
        >
          Diner
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">(opens the booking widget in a new tab)</span>
        </a>
      ) : (
        <span className={cn(base, "opacity-50")}>Diner</span>
      )}
    </div>
  );
}

type StepId = "book" | "agenda" | "cancel";

const STORAGE_PREFIX = "oc-demo-checklist:";

function readTicked(venueId: string): StepId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + venueId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((s) => s === "agenda") as StepId[]) : [];
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
 * Steps 1 and 3 are read from the bookings the guest widget made. "Find it in the agenda" cannot be read from
 * anywhere, so the visitor ticks it. There is no trace step: the staff app has no trace panel yet.
 */
function Checklist({ venueId }: { venueId: string }) {
  const [open, setOpen] = useState(true);
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
  const cancelled = widget.some((r) => r.status === "cancelled");

  const agendaDone = ticked.includes("agenda");
  const done: Record<StepId, boolean> = { book: booked, agenda: agendaDone, cancel: cancelled };

  function toggleAgenda() {
    const next: StepId[] = agendaDone ? [] : ["agenda"];
    setTicked(next);
    writeTicked(venueId, next);
  }

  const steps: { id: StepId; text: string; action?: React.ReactNode }[] = [
    { id: "book", text: "Book a table as a diner. Use the Diner switch above." },
    {
      id: "agenda",
      text: "Find that booking in the agenda.",
      action: (
        <span className="flex gap-2">
          <Button type="button" size="xs" variant="outline" onClick={() => nav?.goTo("agenda")}>
            Open agenda
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={toggleAgenda}>
            {agendaDone ? "Untick" : "Mark as done"}
          </Button>
        </span>
      ),
    },
    { id: "cancel", text: "Cancel it, and watch the table free up on the floor plan." },
  ];
  const count = Object.values(done).filter(Boolean).length;

  return (
    <div className="border-t border-primary/20 px-4 py-1.5 sm:px-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="demo-checklist"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-1 text-sm font-medium"
      >
        <ChevronDownIcon className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
        Take the tour ({count} of {steps.length} done)
      </button>
      {open && (
        <ol id="demo-checklist" className="space-y-1.5 pb-2 pl-6">
          {steps.map((step) => (
            <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {done[step.id] ? (
                <CheckCircle2Icon className="size-4 text-primary" aria-hidden="true" />
              ) : (
                <CircleIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={cn(done[step.id] && "text-muted-foreground line-through")}>
                {step.text}
                <span className="sr-only">{done[step.id] ? " Done." : " Not done yet."}</span>
              </span>
              {step.action}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
