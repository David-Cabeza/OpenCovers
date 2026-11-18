import { useEffect, useRef, type ReactNode } from "react";
import { logoSrc } from "./theme";

/**
 * A step with its heading. `focus` moves focus to the heading when the step appears after a guest action. The
 * first step never takes focus, because focus inside an iframe scrolls the host page to it.
 */
export function Section({ title, focus = false, children }: { title: string; focus?: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus, title]);
  return (
    <section className="space-y-4">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
        {title}
      </h1>
      {children}
    </section>
  );
}

export const inputClass =
  "block w-full rounded-oc border border-border bg-background px-3 py-2 text-base text-text " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-primary aria-invalid:border-danger";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-oc px-4 py-2 font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60";
export const primaryButton = `${buttonClass} w-full bg-primary text-on-primary`;
export const secondaryButton = `${buttonClass} border border-border bg-surface text-text`;
export const dangerButton = `${buttonClass} w-full bg-danger text-on-primary`;

/**
 * The venue's logo from its theme, or nothing when the theme has no valid `https` logo. With `named`, the venue name
 * is already text beside the logo, so the image is decorative and has an empty alt (no double announcement).
 */
export function Logo({ theme, venue, named = false }: { theme: unknown; venue: string; named?: boolean }) {
  const src = logoSrc(theme);
  if (!src) return null;
  return <img src={src} alt={named ? "" : venue} referrerPolicy="no-referrer" decoding="async" className="mb-4 h-12 w-auto max-w-full object-contain" />;
}

/** The venue's logo, its name and its public phone, when it has one, above the step. */
export function VenueHeader({ venue }: { venue: { name: string; phone: string | null; theme?: unknown } }) {
  return (
    <header className="mb-4">
      <Logo theme={venue.theme} venue={venue.name} named />
      <p className="font-medium [overflow-wrap:anywhere]">{venue.name}</p>
      {venue.phone && <p className="text-sm text-muted [overflow-wrap:anywhere]">{venue.phone}</p>}
    </header>
  );
}

export function Field(props: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block font-medium">
        {props.label}
      </label>
      {props.hint && (
        <p id={`${props.id}-hint`} className="text-sm text-muted">
          {props.hint}
        </p>
      )}
      {props.children}
      {props.error && (
        <p id={`${props.id}-error`} className="text-sm text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}
