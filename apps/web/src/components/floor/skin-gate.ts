import { useDemoStatus } from "@/lib/demo";
import { useUiStore } from "@/stores/ui-store";
import type { FloorSkinId } from "./skins";

/**
 * ADR-0020, decision 5: the "Ambiente" look stays unpublished until the skin registry exists, so the
 * hosted demo shows the plan look only, whatever this browser stored. Until the demo answer arrives
 * the plan look is used too. Self-hosted installs keep the switch.
 * Amending the ADR means deleting this file and reading the store directly again.
 */
export function useFloorSkinGate(): { showSwitch: boolean; skin: FloorSkinId } {
  const demo = useDemoStatus();
  const stored = useUiStore((s) => s.floorSkin);
  const open = demo !== null && !demo.enabled;
  return { showSwitch: open, skin: open ? stored : "plano" };
}
