import {
  CalendarClockIcon,
  CalendarDaysIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  ClipboardListIcon,
  GaugeIcon,
  LayoutGridIcon,
  SettingsIcon,
  UserCogIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import { Dialog } from "radix-ui";
import { BrandLogo, BrandMark } from "@/components/brand/brand-mark";
import { useUiStore } from "@/stores/ui-store";
import type { Role } from "@/lib/api";

export type ViewId =
  | "agenda"
  | "floor"
  | "availability"
  | "waitlist"
  | "preshift"
  | "pacing"
  | "setup"
  | "team";

const NAV: {
  id: ViewId;
  label: string;
  icon: typeof CalendarDaysIcon;
  adminOnly?: boolean;
}[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDaysIcon },
  { id: "preshift", label: "Pre-shift", icon: ClipboardListIcon },
  { id: "floor", label: "Floor plan", icon: LayoutGridIcon },
  { id: "availability", label: "Availability", icon: CalendarClockIcon },
  { id: "waitlist", label: "Waitlist", icon: UsersIcon },
  { id: "pacing", label: "Pacing", icon: GaugeIcon },
  { id: "setup", label: "Settings", icon: SettingsIcon },
  { id: "team", label: "Team", icon: UserCogIcon, adminOnly: true },
];

function NavList({
  active,
  onSelect,
  role,
  collapsed = false,
}: {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  role?: Role;
  collapsed?: boolean;
}) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
      {NAV.filter((item) => !item.adminOnly || role === "admin").map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              collapsed && "justify-center px-0",
              isActive && "bg-accent text-accent-foreground",
            )}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-primary"
              />
            )}
            <item.icon className="size-[18px] shrink-0" />
            <span className={cn(collapsed && "sr-only")}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Desktop sidebar (from `lg` up). It can collapse to icons; the choice is remembered. */
export function Sidebar({
  active,
  onSelect,
  role,
}: {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  role?: Role;
}) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 print:hidden lg:flex",
        collapsed ? "w-[4.5rem]" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b",
          collapsed ? "justify-center" : "px-5",
        )}
      >
        {collapsed ? <BrandMark className="size-8 text-primary" /> : <BrandLogo />}
      </div>

      <NavList active={active} onSelect={onSelect} role={role} collapsed={collapsed} />

      <div className="border-t p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-[18px]" />
          ) : (
            <>
              <PanelLeftCloseIcon className="size-[18px]" />
              Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

/** Navigation drawer for screens below `lg`. */
export function MobileNav({
  open,
  onOpenChange,
  active,
  onSelect,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: ViewId;
  onSelect: (view: ViewId) => void;
  role?: Role;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left lg:hidden"
        >
          <div className="flex h-16 items-center justify-between border-b pr-3 pl-5">
            <Dialog.Title asChild>
              <BrandLogo />
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close menu"
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <XIcon className="size-5" />
            </Dialog.Close>
          </div>
          <NavList
            active={active}
            onSelect={(view) => {
              onSelect(view);
              onOpenChange(false);
            }}
            role={role}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
