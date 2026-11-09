import { CalendarDaysIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { useVenues } from "@/hooks/use-venues";
import { useUiStore } from "@/stores/ui-store";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ email }: { email?: string }) {
  const { data } = useVenues();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const venues = data?.venues ?? [];
  const initials = (email ?? "U").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDaysIcon className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">OpenCovers</span>
        </div>

        <div className="flex items-center gap-3">
          {venues.length > 0 && (
            <Select value={venueId ?? undefined} onValueChange={setVenue}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Venue" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                {initials}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => authClient.signOut()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
