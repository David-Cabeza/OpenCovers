import { MenuIcon } from "lucide-react";
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
import { useT } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";
import { LanguageSelect } from "./language-select";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ email, onMenu }: { email?: string; onMenu?: () => void }) {
  const t = useT();
  const { data } = useVenues();
  const venueId = useUiStore((s) => s.venueId);
  const setVenue = useUiStore((s) => s.setVenue);
  const venues = data?.venues ?? [];
  const initials = (email ?? "U").slice(0, 2).toUpperCase();

  return (
    <header className="print:hidden sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenu}
            aria-label={t("layout.topbar.openMenu")}
          >
            <MenuIcon className="size-5" />
          </Button>
          {venues.length > 0 && (
            <Select value={venueId ?? ""} onValueChange={setVenue}>
              <SelectTrigger className="w-full min-w-0 sm:w-[220px]" aria-label={t("layout.topbar.venue")}>
                <SelectValue placeholder={t("layout.topbar.venue")} />
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
        </div>

        <div className="flex items-center gap-3">
          <LanguageSelect />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("layout.topbar.account", { initials })}>
                {initials}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => authClient.signOut()}>
                {t("layout.topbar.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
