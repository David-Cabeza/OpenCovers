import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { cn } from "cn";
import { Pill } from "@/components/pill";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** A titled block inside a settings card, with one line saying what it is for. */
export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="font-display text-lg">{title}</h4>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A switch with its state in words. `live` is what is saved, `checked` is what the form says now. */
export function StatusPanel({
  id,
  label,
  description,
  live,
  checked,
  onCheckedChange,
  onLabel,
  offLabel,
}: {
  id: string;
  label: string;
  description: string;
  live: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors",
        checked && "border-transparent bg-success-soft",
      )}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          <Pill tone={live ? "success" : "muted"} dot>
            {live ? (onLabel ?? t("setup.status.live")) : (offLabel ?? t("setup.status.off"))}
          </Pill>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Save button fixed to the bottom of a long card, so it is reachable without scrolling back up. */
export function SaveBar({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="sticky bottom-0 z-[5] -mx-6 -mb-6 flex items-center gap-3 border-t bg-card/95 px-6 py-3 backdrop-blur">
      {children}
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}
