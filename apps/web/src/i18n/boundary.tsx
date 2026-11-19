import { Fragment, useEffect, type ReactNode } from "react";
import { useLocale } from "./index";

/**
 * Draws its children again from scratch when the language changes, so every text, including those read by plain
 * functions and not by a hook, comes out in the new language. It also keeps `<html lang>` in step, for screen readers
 * and for the browser's own controls (the date picker, spelling). A change of language is rare and deliberate, so
 * losing what was half typed on the screen is the price of not having to follow each string by hand.
 */
export function LocaleBoundary({ children }: { children: ReactNode }) {
  const [locale] = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Fragment key={locale}>{children}</Fragment>;
}
