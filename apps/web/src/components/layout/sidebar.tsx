import {
  CalendarClockIcon,
  CalendarDaysIcon,
  GaugeIcon,
  LayoutGridIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "cn";

export type ViewId =
  | "agenda"
  | "floor"
  | "availability"
  | "waitlist"
  | "pacing"
  | "setup";

const NAV: { id: ViewId; label: string; icon: typeof CalendarDaysIcon }[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDaysIcon },
  { id: "floor", label: "Floor plan", icon: LayoutGridIcon },
  { id: "availability", label: "Availability", icon: CalendarClockIcon },
  { id: "waitlist", label: "Waitlist", icon: UsersIcon },
  { id: "pacing", label: "Pacing", icon: GaugeIcon },
  { id: "setup", label: "Settings", icon: SettingsIcon },
];

export function Sidebar({
  active,
  onSelect,
}: {
  active: ViewId;
  onSelect: (view: ViewId) => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
      <div className="flex items-center gap-2.5 border-b px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CalendarDaysIcon className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">OpenCovers</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active === item.id && "bg-accent text-accent-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
