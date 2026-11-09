import type { Venue } from "./venue";
import type { Auth } from "./auth";

export interface Env {
  VENUE: DurableObjectNamespace<Venue>;
  AUTH: DurableObjectNamespace<Auth>;
  VENUE_JURISDICTION?: string;
}
