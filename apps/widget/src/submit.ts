import type { BookingFields, Created, Failure, FormChallenge, Result } from "./api";

// One booking attempt is one payload, one Idempotency-Key and one solved challenge. A retry of the same payload
// after an answer that may change on repeat (no answer, 429, 5xx) resends all three, so a create that did reach
// the engine replays instead of booking twice (ADR-0017 section 2). Any other answer ends the attempt: the engine
// binds a verified challenge to its key, so the next attempt needs a new key and a new challenge.

export interface Ticket {
  challenge: FormChallenge;
  solution: string;
}

interface Attempt extends Ticket {
  key: string;
  fingerprint: string;
}

export const MIN_FILL_MS = 3_500;
export const MAX_TICKET_AGE_MS = 25 * 60_000;

export function mayRetry(failure: Failure): boolean {
  return failure.kind === "network" || (failure.kind === "error" && failure.retryable);
}

const fingerprintOf = (f: BookingFields) =>
  JSON.stringify([f.date, f.time, f.partySize, f.name.trim(), f.contact.trim(), f.commentary.trim(), f.honeypot]);

export function createSubmitter(deps: {
  send(key: string, fields: BookingFields, ticket: Ticket): Promise<Result<Created>>;
  takeTicket(): Promise<Ticket | null>;
  newKey(): string;
}) {
  let attempt: Attempt | null = null;

  return async function submit(fields: BookingFields): Promise<Result<Created>> {
    const fingerprint = fingerprintOf(fields);
    if (attempt?.fingerprint !== fingerprint) {
      let ticket: Ticket | null;
      try {
        ticket = await deps.takeTicket();
      } catch {
        return { ok: false, failure: { kind: "local" } };
      }
      if (!ticket) return { ok: false, failure: { kind: "network" } };
      attempt = { ...ticket, key: deps.newKey(), fingerprint };
    }
    const current = attempt;
    const result = await deps.send(current.key, fields, current);
    if (result.ok || !mayRetry(result.failure)) attempt = null;
    return result;
  };
}

/**
 * Hands out solved challenges. Each is solved in the background as soon as it arrives, while the guest fills the
 * form, and is handed out once. A challenge younger than the engine's 3-second minimum is held back until it is
 * old enough, and one close to its 30-minute life is replaced by a fresh one.
 */
export function createTicketSource(deps: {
  fetchChallenge(): Promise<FormChallenge | null>;
  solve(challenge: FormChallenge): Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let next: { receivedAt: number; ticket: Promise<Ticket> } | null = null;

  function offer(challenge: FormChallenge) {
    const ticket = deps.solve(challenge).then((solution) => ({ challenge, solution }));
    // A failure surfaces when the ticket is taken, not as an unhandled rejection while it waits.
    ticket.catch(() => undefined);
    next = { receivedAt: now(), ticket };
  }

  async function fetchNext(): Promise<boolean> {
    const challenge = await deps.fetchChallenge().catch(() => null);
    if (challenge) offer(challenge);
    return challenge !== null;
  }

  /** A solved challenge, or null when no new challenge could be fetched. */
  async function take(): Promise<Ticket | null> {
    if ((!next || now() - next.receivedAt > MAX_TICKET_AGE_MS) && !(await fetchNext())) return null;
    const taken = next!;
    next = null;
    // The next attempt's challenge starts solving now, so a guest who must try again does not wait for it.
    void fetchNext();
    const ticket = await taken.ticket;
    const wait = taken.receivedAt + MIN_FILL_MS - now();
    if (wait > 0) await sleep(wait);
    return ticket;
  }

  return { offer, take };
}
