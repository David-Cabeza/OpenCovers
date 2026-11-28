import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";

/** Counted as the API counts it: UTF-16 units after trimming, so an emoji is two or more and a line break is one. */
export const isTooLong = (text: string, limit: number) => text.trim().length > limit;

/** A text box that never cuts what is typed or pasted. The form that holds it must refuse to save while it is too long. */
export function LimitedTextarea({
  id,
  text,
  limit,
  hint,
  "aria-describedby": describedBy,
  ...props
}: React.ComponentProps<typeof Textarea> & { id: string; text: string; limit: number; hint: string }) {
  const t = useT();
  const over = isTooLong(text, limit);
  return (
    <>
      <Textarea
        id={id}
        aria-invalid={over || undefined}
        aria-describedby={`${describedBy ? `${describedBy} ` : ""}${over ? `${id}-error ` : ""}${id}-count ${id}-hint`}
        {...props}
      />
      <p id={`${id}-count`} className={`text-right text-sm tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
        {t("common.charCount", { used: text.trim().length, max: limit })}
      </p>
      {/* No count in here: an alert whose text changes is read again on every key. */}
      {over && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {t("common.tooLong", { max: limit })}
        </p>
      )}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
    </>
  );
}
