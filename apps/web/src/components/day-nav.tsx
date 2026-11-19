import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { shiftIso, todayIso } from "@/lib/date";

/** Previous day, date field, next day, and a way back to today. */
export function DayNav({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const t = useT();
  const today = todayIso();
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("agenda.dayNav.previous")}
          onClick={() => onChange(shiftIso(date, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label={t("agenda.dayNav.date")}
          className="w-fit"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={t("agenda.dayNav.next")}
          onClick={() => onChange(shiftIso(date, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      {date !== today && (
        <Button variant="ghost" onClick={() => onChange(today)}>
          {t("agenda.dayNav.today")}
        </Button>
      )}
    </>
  );
}
