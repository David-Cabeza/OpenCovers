import type { PacingSlot } from "@/lib/api";

export type PacingLevel = "empty" | "low" | "medium" | "high";

/** Share of capacity from which a slot counts as medium or high. */
export const MEDIUM_FROM = 0.5;
export const HIGH_FROM = 0.8;

export function pacingRatio(slot: PacingSlot): number {
  return slot.capacity > 0 ? slot.covers / slot.capacity : 0;
}

export function pacingLevel(slot: PacingSlot): PacingLevel {
  if (slot.covers === 0) return "empty";
  const ratio = pacingRatio(slot);
  if (ratio >= HIGH_FROM) return "high";
  if (ratio >= MEDIUM_FROM) return "medium";
  return "low";
}

/** The slot with the highest share of its capacity booked, or null when nothing is booked. */
export function peakSlot(slots: PacingSlot[]): PacingSlot | null {
  let peak: PacingSlot | null = null;
  for (const slot of slots) {
    if (slot.covers === 0) continue;
    if (!peak || pacingRatio(slot) > pacingRatio(peak)) peak = slot;
  }
  return peak;
}
