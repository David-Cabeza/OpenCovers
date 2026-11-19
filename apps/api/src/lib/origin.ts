/**
 * Who made a change, recorded on each event at write time. `channel` is closed. `actor` is a stable,
 * non-personal reference: a staff user id, an API key's id, or null for a guest. The server derives both
 * from how the request authenticated, never from a body field or from a public caller's header.
 */
export const CHANNELS = ["widget", "staff", "api", "mcp"] as const;
export type EventChannel = (typeof CHANNELS)[number];
export interface Origin {
  channel: EventChannel;
  actor: string | null;
}

/** The header the MCP server sends. Only an API key's request may use it, so it is a label the key holder sets, not proof. */
export const CHANNEL_HEADER = "x-opencovers-channel";

export const WIDGET: Origin = { channel: "widget", actor: null };

export function keyOrigin(keyId: string, header: string | undefined): Origin {
  return { channel: header === "mcp" ? "mcp" : "api", actor: keyId };
}

export function sessionOrigin(userId: string): Origin {
  return { channel: "staff", actor: userId };
}

/** The columns of an event row. No origin (a retention sweep, a pre-existing row) leaves both null: unknown. */
export function originColumns(origin: Origin | null | undefined): { channel: string | null; actor: string | null } {
  return { channel: origin?.channel ?? null, actor: origin?.actor ?? null };
}
