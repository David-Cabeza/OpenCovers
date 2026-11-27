import { CloudOffIcon } from "lucide-react";

/**
 * The notice of a screen whose data could not be updated. Put it last in the view: it sticks to the bottom of the
 * window without moving what is above it. The live region stays mounted and its text only changes when the message
 * does, so it is read out once and not on every retry.
 */
export function StaleNotice({ message }: { message: string | null }) {
  return (
    <>
      {/* `aria-live` written out: an open dialog hides the page from screen readers, except what carries it. */}
      <p role="status" aria-live="polite" className="sr-only print:hidden">
        {message}
      </p>
      {message && (
        <div aria-hidden="true" data-slot="stale-notice" className="pointer-events-none sticky bottom-3 z-10 print:hidden">
          <p className="mx-auto flex w-fit items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning shadow-md">
            <CloudOffIcon className="size-4 shrink-0" />
            {message}
          </p>
        </div>
      )}
    </>
  );
}
