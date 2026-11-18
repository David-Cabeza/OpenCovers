import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shiftIso, todayIso } from "@/lib/date";

/** Previous day, date field, next day, and a way back to today. */
export function DayNav({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const today = todayIso();
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous day"
          onClick={() => onChange(shiftIso(date, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Date"
          className="w-fit"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Next day"
          onClick={() => onChange(shiftIso(date, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      {date !== today && (
        <Button variant="ghost" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
    </>
  );
}
