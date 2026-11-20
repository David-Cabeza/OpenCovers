import type { PublicSlot } from "./api";

// Zones and service names of the times step (ADR-0021 stage 6, C66). Everything here is driven by the answer.

/** Whether the config offers a zone choice: two or more public zones. */
export const hasZoneChoice = (zones: string[] | undefined): zones is string[] => (zones?.length ?? 0) >= 2;

export interface SlotGroup {
  /** The service heading as the API gave it, or null for the flat list. */
  service: string | null;
  slots: PublicSlot[];
}

/**
 * The times as groups. Slots with a `service` form one group per service, in the order the services first
 * appear. With no `service` on any slot there is one group with a null heading: the flat list.
 */
export function groupSlots(slots: PublicSlot[]): SlotGroup[] {
  if (!slots.some((slot) => slot.service)) return [{ service: null, slots }];
  const groups: SlotGroup[] = [];
  for (const slot of slots) {
    const service = slot.service ?? "";
    let group = groups.find((g) => g.service === service);
    if (!group) groups.push((group = { service, slots: [] }));
    group.slots.push(slot);
  }
  return groups;
}

/** The zones to show beside a time: only while no zone is chosen, and none when the list is empty. */
export const zonesToShow = (slot: PublicSlot, chosen: string): string[] => (chosen ? [] : (slot.zones ?? []));
