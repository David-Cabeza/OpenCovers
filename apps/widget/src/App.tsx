import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { selfServiceUrl, type Created, type Joined, type Failure, type PublicApi, type PublicConfig, type PublicDay, type PublicSlot } from "./api";
import { DayStrip } from "./DayStrip";
import { addDays, formatDate, isoWeekday, todayLocal } from "./dates";
import { explain, type Explanation } from "./errors";
import { LostLink } from "./LostLink";
import type { Translate } from "./messages";
import { solveInBackground } from "./pow";
import { dateAfterPartyChange, nextFreeDay, pageBounds, startFor, STRIP_DAYS, visibleDays } from "./strip";
import { createSubmitter, createTicketSource } from "./submit";
import { noticeHref, watchTheme } from "./theme";
import { Field, inputClass, primaryButton, secondaryButton, Section, VenueHeader } from "./ui";
import { groupSlots, hasZoneChoice, zonesToShow } from "./zones";
import { WaitlistJoin, WaitlistJoined, WaitlistOffer } from "./WaitlistJoin";
import { checkDetails, withoutError, type DetailErrors } from "./validate";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "load-failed" }
  | { kind: "booking"; config: PublicConfig }
  | { kind: "done"; config: PublicConfig; created: Created }
  | { kind: "waitlisted"; joined: Joined };

type Times =
  | { kind: "pick-date" }
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "loaded"; times: string[]; slots: PublicSlot[] | null; reason: "past_date" | "beyond_horizon" | null }
  | { kind: "failed"; failure: Failure };

// `hidden`: the days route failed or is limited, so the form works from the date field alone.
type Strip = { kind: "loading" } | { kind: "ready"; days: PublicDay[] } | { kind: "hidden" };

type Step = "choose" | "summary" | "details" | "waitlist";

// A stable function, so the waitlist form keeps its idempotency key across renders.
const newKey = () => crypto.randomUUID();

type Sending = null | { kind: "checking" } | { kind: "sending" };

export function App({ api, t, locale }: { api: PublicApi; t: Translate; locale: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void api.config().then((result) => {
      if (!live) return;
      if (result.ok) {
        document.title = t("page.title", { venue: result.value.venue.name });
        watchTheme(result.value.venue.theme, window);
        setPhase({ kind: "booking", config: result.value });
      } else {
        // Only a venue the engine does not know, or one with online booking off, is "unavailable". A dropped
        // connection or a server error is transient, so the guest can retry instead of leaving.
        const gone = result.failure.kind === "error" && result.failure.code === "venue_not_found";
        setPhase({ kind: gone ? "unavailable" : "load-failed" });
      }
    });
    return () => {
      live = false;
    };
  }, [api, t, attempt]);

  return (
    <main className="mx-auto w-full max-w-md p-4 text-text">
      {"config" in phase && <VenueHeader venue={phase.config.venue} />}
      {phase.kind === "loading" && <p role="status">{t("loading")}</p>}
      {phase.kind === "unavailable" && (
        <Section title={t("unavailable.title")}>
          <p>{t("unavailable.body")}</p>
        </Section>
      )}
      {phase.kind === "load-failed" && (
        <Section title={t("loadFailed.title")} focus>
          <p role="alert">{t("loadFailed.body")}</p>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setPhase({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {t("action.retry")}
          </button>
        </Section>
      )}
      {phase.kind === "booking" && (
        <BookingForm
          api={api}
          t={t}
          locale={locale}
          config={phase.config}
          onDone={(created) => setPhase({ kind: "done", config: phase.config, created })}
          onWaitlisted={(joined) => setPhase({ kind: "waitlisted", joined })}
        />
      )}
      {phase.kind === "booking" && phase.config.linkResend && <LostLink api={api} t={t} />}
      {phase.kind === "waitlisted" && <WaitlistJoined t={t} locale={locale} joined={phase.joined} />}
      {phase.kind === "done" && <Confirmation t={t} locale={locale} created={phase.created} />}
    </main>
  );
}

function BookingForm(props: {
  api: PublicApi;
  t: Translate;
  locale: string;
  config: PublicConfig;
  onDone(created: Created): void;
  onWaitlisted(joined: Joined): void;
}) {
  const { api, t, locale, config, onDone, onWaitlisted } = props;
  const ids = useId();
  const today = todayLocal();
  const maxDate = config.maxAdvanceDays === null ? undefined : addDays(today, config.maxAdvanceDays);

  const [step, setStepState] = useState<Step>("choose");
  const [moved, setMoved] = useState(false);
  const setStep = (next: Step) => {
    setMoved(true);
    setStepState(next);
  };
  const [date, setDate] = useState("");
  const [party, setParty] = useState<number | "more">(Math.min(Math.max(2, config.minPartySize), config.maxPartySize));
  const [time, setTime] = useState("");
  // The chosen public zone; "" is any zone and sends nothing.
  const [zone, setZone] = useState("");
  const zones = hasZoneChoice(config.zones) ? config.zones : [];
  // Until the first days answer arrives there is no date, and the times area says it is loading.
  const [starting, setStarting] = useState(true);
  const [times, setTimes] = useState<Times>({ kind: "loading" });
  const [strip, setStrip] = useState<Strip>({ kind: "loading" });
  // The first day of the strip. One `/days` call per (from, party).
  const [stripFrom, setStripFrom] = useState(today);
  const stripParty = useRef<number | "more" | null>(null);
  const stripFailed = useRef(false);
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<DetailErrors & { time?: "validate.time" }>({});
  const [notice, setNotice] = useState<Explanation | null>(null);
  const [sending, setSending] = useState<Sending>(null);
  const [tries, setTries] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLInputElement>(null);

  const { submit, takeTicket } = useMemo(() => {
    const tickets = createTicketSource({
      fetchChallenge: async () => {
        const result = await api.config();
        return result.ok ? result.value.challenge : null;
      },
      solve: (challenge) => {
        setTries(0);
        return solveInBackground(challenge, setTries);
      },
    });
    tickets.offer(config.challenge);
    // One ticket source serves the booking and the waitlist join: a challenge is spent once, whichever uses it.
    const submit = createSubmitter({
      takeTicket: tickets.take,
      newKey,
      send: (key, fields, ticket) => {
        setSending({ kind: "sending" });
        return api.create(key, fields, ticket.challenge, ticket.solution);
      },
    });
    return { submit, takeTicket: tickets.take };
  }, [api, config]);

  // The strip and the first date. A guest who already picked a date keeps it, and so does a changed party while
  // that date can still be picked.
  useEffect(() => {
    if (party === "more" || stripFailed.current) {
      if (starting) {
        setDate((current) => current || today);
        setStarting(false);
      }
      return;
    }
    let live = true;
    setStrip({ kind: "loading" });
    void api.days(stripFrom, STRIP_DAYS, party).then((result) => {
      if (!live) return;
      const partyChanged = stripParty.current !== null && stripParty.current !== party;
      stripParty.current = party;
      if (!result.ok) {
        stripFailed.current = true;
        setStrip({ kind: "hidden" });
        setDate((current) => current || today);
        setStarting(false);
        return;
      }
      const days = result.value.days;
      setStrip({ kind: "ready", days });
      setDate((current) => {
        if (!current) return days.find((day) => day.status === "available")?.date ?? today;
        return partyChanged ? dateAfterPartyChange(days, current) : current;
      });
      setStarting(false);
    });
    return () => {
      live = false;
    };
    // `today` and `maxDate` come from the same render as `config`.
  }, [api, config, stripFrom, party]);

  // Runs again on every return to the times step, so slots that went stale while the guest filled in the
  // details (taken, or inside the lead time by now) are never listed again.
  useEffect(() => {
    if (step !== "choose") return;
    if (!date && starting) return setTimes({ kind: "loading" });
    if (!date || party === "more") return setTimes({ kind: "pick-date" });
    if (!config.weekdays.includes(isoWeekday(date))) return setTimes({ kind: "closed" });
    let live = true;
    setTimes({ kind: "loading" });
    void api.availability(date, party, zone || undefined).then((result) => {
      if (!live) return;
      if (result.ok) {
        const listed = result.value.times;
        setTimes({ kind: "loaded", times: listed, slots: result.value.slots ?? null, reason: result.value.reason ?? null });
        // A chosen time that this answer no longer lists (another zone) is cleared.
        setTime((current) => (current && !listed.includes(current) ? "" : current));
      } else setTimes({ kind: "failed", failure: result.failure });
    });
    return () => {
      live = false;
    };
  }, [api, config, date, party, zone, reload, step, starting]);

  const stripDays = strip.kind === "ready" ? strip.days : [];
  const noFreeDay =
    party !== "more" && (times.kind === "closed" || (times.kind === "loaded" && times.times.length === 0 && !times.reason));
  // The waitlist is offered only on a day the strip reports `full` for this party (ADR-0021 section 5).
  const selectedDay = stripDays.find((day) => day.date === date);
  const offerWaitlist = config.waitlistEnabled === true && party !== "more" && selectedDay?.status === "full";
  const freeDay = noFreeDay && date ? nextFreeDay(stripDays, date) : null;
  const bounds = pageBounds({ from: stripFrom, today, last: maxDate });
  const pick = (day: string) => {
    setDate(day);
    setTime("");
  };

  const partyLabel = (n: number) => (n === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n }));
  const noticeText = (e: Explanation) =>
    e.phone && config.venue.phone ? t("error.genericPhone", { phone: config.venue.phone }) : t(e.message);

  function choose(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!time || times.kind !== "loaded" || !times.times.includes(time)) {
      setErrors({ time: "validate.time" });
      return;
    }
    setErrors({});
    setStep("summary");
  }

  async function book(event: FormEvent) {
    event.preventDefault();
    if (sending || party === "more") return;
    const found = checkDetails(name, contact);
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.contact) return contactRef.current?.focus();
    setNotice(null);
    setSending({ kind: "checking" });
    const result = await submit({ date, time, partySize: party, name, contact, commentary: note, honeypot, ...(zone ? { zone } : {}) });
    setSending(null);
    if (result.ok) return onDone(result.value);
    const explanation = explain(result.failure);
    setNotice(explanation);
    if (explanation.back === "time") {
      setTime("");
      setStep("choose");
      setReload((n) => n + 1);
    }
  }

  const alert = (
    <div role="alert" className={notice ? "rounded-oc border border-danger p-3 text-danger" : undefined}>
      {notice ? noticeText(notice) : null}
    </div>
  );

  if (step === "choose") {
    const partyOptions = [];
    for (let n = config.minPartySize; n <= config.maxPartySize; n += 1) partyOptions.push(n);
    return (
      <Section title={t("step.choose")} focus={moved}>
        {alert}
        <form className="space-y-4" onSubmit={choose} noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${ids}-date`} className="block font-medium">
                {t("field.date")}
              </label>
              <input
                id={`${ids}-date`}
                type="date"
                required
                min={today}
                max={maxDate}
                value={date}
                onChange={(e) => {
                  pick(e.target.value);
                  // A date outside the strip loads the strip from that date.
                  if (e.target.value) setStripFrom((from) => startFor(e.target.value, from, today));
                }}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${ids}-party`} className="block font-medium">
                {t("field.party")}
              </label>
              <select
                id={`${ids}-party`}
                value={String(party)}
                onChange={(e) => {
                  setParty(e.target.value === "more" ? "more" : Number(e.target.value));
                  setTime("");
                }}
                className={inputClass}
              >
                {partyOptions.map((n) => (
                  <option key={n} value={n}>
                    {partyLabel(n)}
                  </option>
                ))}
                <option value="more">{t("field.partyMore", { n: config.maxPartySize })}</option>
              </select>
            </div>
          </div>

          {party !== "more" && strip.kind === "loading" && <p role="status">{t("strip.loading")}</p>}
          {party !== "more" && strip.kind === "ready" && (
            <DayStrip
              days={visibleDays(strip.days)}
              selected={date}
              t={t}
              locale={locale}
              onSelect={pick}
              onPrev={bounds.prev ? () => setStripFrom(bounds.prev!) : undefined}
              onNext={bounds.next ? () => setStripFrom(bounds.next!) : undefined}
            />
          )}

          {party === "more" ? (
            <p role="status">
              {config.venue.phone
                ? t("party.largePhone", { n: config.maxPartySize, phone: config.venue.phone })
                : t("party.large", { n: config.maxPartySize })}
            </p>
          ) : (
            <>
            {zones.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="font-medium">{t("zone.label")}</legend>
                <div className="flex flex-wrap gap-2">
                  {[{ value: "", label: t("zone.any") }, ...zones.map((name) => ({ value: name, label: name }))].map((option) => (
                    <label key={option.value || "any"} className="relative">
                      <input
                        type="radio"
                        name={`${ids}-zone`}
                        value={option.value}
                        checked={zone === option.value}
                        onChange={() => setZone(option.value)}
                        className="peer absolute inset-0 opacity-0"
                      />
                      <span className={chipClass + " [overflow-wrap:anywhere]"}>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset className="space-y-2" aria-describedby={errors.time ? `${ids}-time-error` : undefined}>
              <legend className="font-medium">{t("field.time")}</legend>
              <TimeList
                times={times}
                t={t}
                party={party}
                name={`${ids}-time`}
                value={time}
                zone={zone}
                onChange={(value) => {
                  setTime(value);
                  setErrors({});
                }}
                explain={(failure) => noticeText(explain(failure))}
                onRetry={() => setReload((n) => n + 1)}
              />
              {offerWaitlist && <WaitlistOffer t={t} party={party} onJoin={() => setStep("waitlist")} />}
              {freeDay && (
                <button type="button" className={secondaryButton} onClick={() => pick(freeDay)}>
                  {t("strip.nextFree")}
                </button>
              )}
              {errors.time && (
                <p id={`${ids}-time-error`} className="text-danger">
                  {t(errors.time)}
                </p>
              )}
            </fieldset>
            </>
          )}

          {party !== "more" && !noFreeDay && (
            <button type="submit" className={primaryButton}>
              {t("action.continue")}
            </button>
          )}
        </form>
      </Section>
    );
  }

  const partySize = party === "more" ? 0 : party;
  if (step === "waitlist" && party !== "more") {
    return (
      <WaitlistJoin
        api={api}
        t={t}
        locale={locale}
        config={config}
        date={date}
        party={party}
        takeTicket={takeTicket}
        tries={tries}
        newKey={newKey}
        onBack={() => setStep("choose")}
        onJoined={onWaitlisted}
      />
    );
  }
  if (step === "summary") {
    const edit = (field: string) => (
      <button
        type="button"
        className="min-h-11 shrink-0 px-2 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={t("summary.edit", { field })}
        onClick={() => setStep("choose")}
      >
        {t("action.edit")}
      </button>
    );
    const rows = [
      { label: t("field.date"), value: formatDate(date, locale) },
      { label: t("field.time"), value: time },
      { label: t("field.party"), value: partyLabel(partySize) },
      ...(zone ? [{ label: t("zone.label"), value: zone }] : []),
    ];
    return (
      <Section title={t("step.summary")} focus>
        <ul className="divide-y divide-border rounded-oc border border-border bg-surface">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 px-3 py-1">
              <p className="min-w-0">
                <span className="block text-sm text-muted">{row.label}</span>
                <span className="block font-medium [overflow-wrap:anywhere]">{row.value}</span>
              </p>
              {edit(row.label)}
            </li>
          ))}
          {config.venue.address && (
            <li className="px-3 py-2">
              <span className="block text-sm text-muted">{t("summary.address")}</span>
              <span className="block font-medium [overflow-wrap:anywhere]">{config.venue.address}</span>
            </li>
          )}
        </ul>
        <div className="flex gap-3">
          <button type="button" className={secondaryButton} onClick={() => setStep("choose")}>
            {t("action.back")}
          </button>
          <button type="button" className={primaryButton} onClick={() => setStep("details")}>
            {t("action.continue")}
          </button>
        </div>
      </Section>
    );
  }

  const privacyHref = noticeHref(config.privacyNoticeUrl);
  const progress = Math.min(99, Math.floor((tries / 2 ** config.challenge.difficulty) * 100));
  return (
    <Section title={t("step.details")} focus>
      <p className="rounded-oc bg-surface p-3">
        {t("summary", { date: formatDate(date, locale), time, party: partyLabel(partySize) })}
      </p>
      {alert}
      <form className="space-y-4" onSubmit={book} noValidate aria-busy={sending !== null}>
        <Field id={`${ids}-name`} label={t("field.name")} error={errors.name && t(errors.name)}>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            type="text"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((current) => withoutError(current, "name"));
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${ids}-name-error` : undefined}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${ids}-contact`}
          label={t("field.contact")}
          hint={t("field.contactHint")}
          error={errors.contact && t(errors.contact)}
        >
          <input
            ref={contactRef}
            id={`${ids}-contact`}
            type="text"
            autoComplete="email"
            required
            maxLength={254}
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
              setErrors((current) => withoutError(current, "contact"));
            }}
            aria-invalid={errors.contact ? true : undefined}
            aria-describedby={`${ids}-contact-hint${errors.contact ? ` ${ids}-contact-error` : ""}`}
            className={inputClass}
          />
        </Field>
        <Field id={`${ids}-note`} label={t("field.note")} hint={t("field.noteHint")}>
          <textarea
            id={`${ids}-note`}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={`${ids}-note-hint`}
            className={inputClass}
          />
        </Field>
        <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label htmlFor={`${ids}-extra`}>{t("field.honeypot")}</label>
          <input
            id={`${ids}-extra`}
            name="oc-extra"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <p role="status" aria-live="polite" className="min-h-6 text-muted">
          {sending?.kind === "checking" && t("progress.checking", { percent: progress })}
          {sending?.kind === "sending" && t("progress.sending")}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            className={secondaryButton}
            disabled={sending !== null}
            onClick={() => {
              setNotice(null);
              setStep("summary");
            }}
          >
            {t("action.back")}
          </button>
          <button type="submit" className={primaryButton} disabled={sending !== null}>
            {t("action.book")}
          </button>
        </div>
        {privacyHref && (
          <p>
            <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 py-2 underline [overflow-wrap:anywhere]">
              {t("notice.privacy")}
            </a>
          </p>
        )}
      </form>
    </Section>
  );
}

const chipClass =
  "inline-flex min-h-11 min-w-16 flex-col items-center justify-center rounded-oc border border-border bg-surface " +
  "px-3 py-1 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-primary " +
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary";

export function TimeList(props: {
  times: Times;
  t: Translate;
  party: number;
  name: string;
  value: string;
  zone?: string;
  onChange(value: string): void;
  explain(failure: Failure): string;
  onRetry?(): void;
}) {
  const { times, t } = props;
  const chosenZone = props.zone ?? "";
  if (times.kind === "pick-date") return <p className="text-muted">{t("times.pickDate")}</p>;
  if (times.kind === "closed") return <p role="status">{t("times.closed")}</p>;
  if (times.kind === "loading") return <p role="status">{t("times.loading")}</p>;
  if (times.kind === "failed") {
    return (
      <div className="space-y-2">
        <p role="status">{props.explain(times.failure)}</p>
        {props.onRetry && (
          <button type="button" className={secondaryButton} onClick={props.onRetry}>
            {t("action.retry")}
          </button>
        )}
      </div>
    );
  }
  if (times.times.length === 0) {
    if (times.reason === "past_date") return <p role="status">{t("times.pastDate")}</p>;
    if (times.reason === "beyond_horizon") return <p role="status">{t("times.tooFar")}</p>;
    return <p role="status">{t("times.none", { n: props.party })}</p>;
  }
  const slots: PublicSlot[] = times.slots ?? times.times.map((time) => ({ time }));
  const groups = groupSlots(slots);
  const chips = (list: PublicSlot[]) => (
    <div className="flex flex-wrap gap-2">
      {list.map((slot) => {
        const shown = zonesToShow(slot, chosenZone);
        const zoneText = shown.join(", ");
        return (
          <label key={slot.time} className="group relative">
            <input
              type="radio"
              name={props.name}
              value={slot.time}
              checked={props.value === slot.time}
              onChange={() => props.onChange(slot.time)}
              aria-label={zoneText ? t("times.withZones", { time: slot.time, zones: zoneText }) : undefined}
              className="peer absolute inset-0 opacity-0"
            />
            <span className={chipClass}>
              <span>{slot.time}</span>
              {zoneText && <span className="text-xs text-muted group-has-[:checked]:text-on-primary">{zoneText}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
  if (groups.length === 1 && groups[0].service === null) return chips(slots);
  return (
    <div className="space-y-3">
      {groups.map((group, index) => (
        <div key={`${index}-${group.service}`} role="group" aria-label={group.service || undefined} className="space-y-1">
          {group.service && <p className="text-sm font-medium text-muted [overflow-wrap:anywhere]">{group.service}</p>}
          {chips(group.slots)}
        </div>
      ))}
    </div>
  );
}

function Confirmation({ t, locale, created }: { t: Translate; locale: string; created: Created }) {
  const { reservation, selfServiceToken } = created;
  const [copied, setCopied] = useState(false);
  const ids = useId();
  const link = selfServiceToken ? selfServiceUrl(window.location.origin, selfServiceToken, locale) : null;
  const party = reservation.partySize === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n: reservation.partySize });
  return (
    <Section title={t("done.title")} focus>
      <p>
        {t("done.body", {
          date: formatDate(reservation.date, locale),
          time: reservation.time,
          party,
          name: reservation.guest.name,
        })}
      </p>
      <p className="text-muted">{t("done.contact", { contact: reservation.guest.contact })}</p>
      {link ? (
        <div className="space-y-2 rounded-oc border border-border bg-surface p-3">
          <label htmlFor={`${ids}-link`} className="block font-medium">
            {t("done.linkTitle")}
          </label>
          <p id={`${ids}-link-hint`} className="text-sm text-muted">
            {t("done.linkBody")}
          </p>
          <input
            id={`${ids}-link`}
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            aria-describedby={`${ids}-link-hint`}
            className={inputClass}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {t("action.copy")}
            </button>
            <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
              {t("action.open")}
            </a>
            <span role="status" className="text-sm text-muted">
              {copied ? t("action.copied") : ""}
            </span>
          </div>
        </div>
      ) : (
        <p>{t("done.noLink")}</p>
      )}
    </Section>
  );
}
