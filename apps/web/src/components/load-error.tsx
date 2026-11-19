import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isServerUnreachable } from "@/lib/server-status";
import { cn } from "cn";
import { useT } from "@/i18n";

/**
 * What a screen or card shows when its data could not be loaded, instead of an empty list that would say "nothing
 * here" about something that was never read. It says what failed and offers to ask again.
 */
export function LoadError({
  title,
  what,
  error,
  onRetry,
  retrying = false,
  compact = false,
}: {
  /** The whole heading, already translated: "Could not load the agenda". */
  title?: string;
  /** Deprecated: what could not be loaded, in English, as it reads after "Could not load". Use `title`. */
  what?: string;
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
  /** For inside a card: no dashed frame and less padding. */
  compact?: boolean;
}) {
  const t = useT();
  const unreachable = isServerUnreachable(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        compact ? "py-4" : "rounded-lg border border-dashed py-16",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-warning-soft text-warning",
          compact ? "size-9" : "size-12",
        )}
      >
        <TriangleAlertIcon className={compact ? "size-4" : "size-6"} aria-hidden="true" />
      </div>
      <p className="font-medium">{title ?? t("layout.loadError.title", { what: what ?? "" })}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {unreachable ? t("layout.loadError.unreachable") : t("layout.loadError.serverError")}
      </p>
      <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
        {retrying ? t("common.trying") : t("common.tryAgain")}
      </Button>
    </div>
  );
}
