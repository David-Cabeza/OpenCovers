import { cn } from "cn";
import { useT } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";
import { FLOOR_SKIN_LIST } from "./skins";

// Per-user choice of how the floor plan is drawn. Stored in this browser only.
export function FloorSkinToggle() {
  const t = useT();
  const skin = useUiStore((s) => s.floorSkin);
  const setSkin = useUiStore((s) => s.setFloorSkin);
  return (
    <div role="group" aria-label={t("floor.skin.group")} className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {FLOOR_SKIN_LIST.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={skin === s.id}
          title={t(s.descriptionKey)}
          onClick={() => setSkin(s.id)}
          className={cn(
            "rounded-md px-3 py-1 font-medium max-sm:min-h-11 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            skin === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(s.labelKey)}
        </button>
      ))}
    </div>
  );
}
