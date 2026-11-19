import { useEffect, useRef } from "react";
import type { PublicDay } from "./api";
import { formatDate, formatWeekdayLetter } from "./dates";
import type { MessageId, Translate } from "./messages";
import { isSelectable } from "./strip";

const NAME: Record<"available" | "full" | "closed", MessageId> = {
  available: "strip.dayAvailable",
  full: "strip.dayFull",
  closed: "strip.dayClosed",
};

const chipShape = {
  available: "border-border bg-surface text-text",
  // Dashed outline and no fill: a full day looks different without relying on colour.
  full: "border-dashed border-text bg-transparent text-text",
  // Muted, struck through and without a hover state: a closed day cannot be picked.
  closed: "border-transparent bg-transparent text-muted line-through opacity-70",
} as const;

/** The small mark under a day, and in the legend: a dot, a ring or a dash. Decorative, the name says the state. */
function Mark({ status, spaced = true }: { status: "available" | "full" | "closed"; spaced?: boolean }) {
  const base = `${spaced ? "mt-1 " : ""}block shrink-0`;
  if (status === "closed") return <span aria-hidden="true" className={`${base} h-0.5 w-2 rounded-full bg-current`} />;
  return (
    <span
      aria-hidden="true"
      className={`${base} h-2 w-2 rounded-full ${status === "full" ? "border-2 border-current" : "bg-current"}`}
    />
  );
}

const arrow =
  "inline-flex min-h-11 min-w-10 shrink-0 items-center justify-center rounded-oc border border-border bg-surface " +
  "text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40";

export function DayStrip(props: {
  days: PublicDay[];
  selected: string;
  t: Translate;
  locale: string;
  onSelect(date: string): void;
  /** Absent when there is no previous (or next) page: the button is then disabled. */
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { days, selected, t, locale } = props;
  const scroller = useRef<HTMLDivElement>(null);

  // Keeps the selected chip in view by moving the strip itself, never the page: scrollIntoView would also scroll
  // the host page when the widget is framed.
  useEffect(() => {
    const box = scroller.current;
    const chip = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!box || !chip) return;
    box.scrollLeft = chip.offsetLeft - box.clientWidth / 2 + chip.offsetWidth / 2;
  }, [selected, days]);

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-1">
        <button type="button" className={arrow} aria-label={t("strip.prev")} disabled={!props.onPrev} onClick={props.onPrev}>
          <span aria-hidden="true">‹</span>
        </button>
        <div
          ref={scroller}
          role="group"
          aria-label={t("strip.label")}
          className="relative flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto pb-1 [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
        >
          {days.map((day) => {
            const status = day.status === "outside_window" ? "closed" : day.status;
            const isSelected = day.date === selected && isSelectable(day);
            const selectable = isSelectable(day);
            return (
              <button
                key={day.date}
                type="button"
                aria-label={t(NAME[status], { date: formatDate(day.date, locale) })}
                aria-pressed={selectable ? isSelected : undefined}
                aria-disabled={selectable ? undefined : true}
                onClick={() => selectable && props.onSelect(day.date)}
                className={
                  "flex min-h-14 min-w-11 shrink-0 snap-center flex-col items-center justify-center rounded-oc border px-1 " +
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                  (isSelected ? "border-primary bg-primary text-on-primary" : chipShape[status]) +
                  (selectable ? "" : " cursor-default")
                }
              >
                <span aria-hidden="true" className="text-xs uppercase">
                  {formatWeekdayLetter(day.date, locale)}
                </span>
                <span aria-hidden="true" className="text-base font-medium">
                  {Number(day.date.slice(8))}
                </span>
                <Mark status={status} />
              </button>
            );
          })}
        </div>
        <button type="button" className={arrow} aria-label={t("strip.next")} disabled={!props.onNext} onClick={props.onNext}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-hidden="true">
        {(["available", "full", "closed"] as const).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <Mark status={status} spaced={false} />
            {t(`strip.legend${status[0].toUpperCase()}${status.slice(1)}` as MessageId)}
          </li>
        ))}
      </ul>
    </div>
  );
}
