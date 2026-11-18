import { cn } from "cn";
import { useUiStore } from "@/stores/ui-store";
import { FLOOR_SKIN_LIST } from "./skins";

// Per-user choice of how the floor plan is drawn. Stored in this browser only.
export function FloorSkinToggle() {
  const skin = useUiStore((s) => s.floorSkin);
  const setSkin = useUiStore((s) => s.setFloorSkin);
  return (
    <div role="group" aria-label="Floor plan look" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {FLOOR_SKIN_LIST.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={skin === s.id}
          title={s.description}
          onClick={() => setSkin(s.id)}
          className={cn(
            "rounded-md px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            skin === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
