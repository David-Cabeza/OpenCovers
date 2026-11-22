import { CheckIcon, LanguagesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_NAMES, useLocale, useT } from "@/i18n";

/**
 * Chooses the language of the app. The accessible name starts with the visible code ("en"), so voice control that says
 * what it sees finds the button (WCAG 2.5.3). The choice is kept in this browser, like the theme.
 */
export function LanguageSelect() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" aria-label={`${locale} · ${t("common.language")}: ${LOCALE_NAMES[locale]}`}>
          <LanguagesIcon className="size-4" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l} lang={l} onSelect={() => setLocale(l)} className="justify-between gap-4">
            {LOCALE_NAMES[l]}
            {l === locale && <CheckIcon className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
