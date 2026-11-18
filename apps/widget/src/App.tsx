import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { selfServiceUrl, type Created, type Failure, type PublicApi, type PublicConfig } from "./api";
import { addDays, formatDate, isoWeekday, todayLocal } from "./dates";
import { explain, type Explanation } from "./errors";
import { LostLink } from "./LostLink";
import type { Translate } from "./messages";
import { solveInBackground } from "./pow";
import { createSubmitter, createTicketSource } from "./submit";
import { applyTheme } from "./theme";
import { Field, inputClass, primaryButton, secondaryButton, Section, VenueHeader } from "./ui";
import { checkDetails, type DetailErrors } from "./validate";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "booking"; config: PublicConfig }
  | { kind: "done"; config: PublicConfig; created: Created };

type Times =
  | { kind: "pick-date" }
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "loaded"; times: string[]; reason: "past_date" | "beyond_horizon" | null }
  | { kind: "failed"; failure: Failure };

type Sending = null | { kind: "checking" } | { kind: "sending" };

export function App({ api, t, locale }: { api: PublicApi; t: Translate; locale: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void api.config().then((result) => {
      if (!live) return;
      if (result.ok) {
        document.title = t("page.title", { venue: result.value.venue.name });
        applyTheme(result.value.venue.theme, document.documentElement.style);
        setPhase({ kind: "booking", config: result.value });
      } else setPhase({ kind: "unavailable" });
    });
    return () => {
      live = false;
    };
  }, [api, t]);

  return (
    <main className="mx-auto w-full max-w-md p-4 text-text">
      {"config" in phase && <VenueHeader venue={phase.config.venue} />}
      {phase.kind === "loading" && <p role="status">{t("loading")}</p>}
      {phase.kind === "unavailable" && (
        <Section title={t("unavailable.title")}>
          <p>{t("unavailable.body")}</p>
        </Section>
      )}
      {phase.kind === "booking" && (
        <BookingForm
          api={api}
          t={t}
          locale={locale}
          config={phase.config}
          onDone={(created) => setPhase({ kind: "done", config: phase.config, created })}
        />
      )}
      {phase.kind === "booking" && phase.config.linkResend && <LostLink api={api} t={t} />}
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
}) {
  const { api, t, locale, config, onDone } = props;
  const ids = useId();
  const today = todayLocal();
  const maxDate = config.maxAdvanceDays === null ? undefined : addDays(today, config.maxAdvanceDays);

  const [step, setStepState] = useState<"choose" | "details">("choose");
  const [moved, setMoved] = useState(false);
  const setStep = (next: "choose" | "details") => {
    setMoved(true);
    setStepState(next);
  };
  const [date, setDate] = useState("");
  const [party, setParty] = useState<number | "more">(Math.min(Math.max(2, config.minPartySize), config.maxPartySize));
  const [time, setTime] = useState("");
  const [times, setTimes] = useState<Times>({ kind: "pick-date" });
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

  const submit = useMemo(() => {
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
    return createSubmitter({
      takeTicket: tickets.take,
      newKey: () => crypto.randomUUID(),
      send: (key, fields, ticket) => {
        setSending({ kind: "sending" });
        return api.create(key, fields, ticket.challenge, ticket.solution);
      },
    });
  }, [api, config]);

  // Runs again on every return to the times step, so slots that went stale while the guest filled in the
  // details (taken, or inside the lead time by now) are never listed again.
  useEffect(() => {
    if (step !== "choose") return;
    if (!date || party === "more") return setTimes({ kind: "pick-date" });
    if (!config.weekdays.includes(isoWeekday(date))) return setTimes({ kind: "closed" });
    let live = true;
    setTimes({ kind: "loading" });
    void api.availability(date, party).then((result) => {
      if (!live) return;
      setTimes(result.ok ? { kind: "loaded", times: result.value.times, reason: result.value.reason ?? null } : { kind: "failed", failure: result.failure });
    });
    return () => {
      live = false;
    };
  }, [api, config, date, party, reload, step]);

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
    setStep("details");
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
    const result = await submit({ date, time, partySize: party, name, contact, commentary: note, honeypot });
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
                  setDate(e.target.value);
                  setTime("");
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

          {party === "more" ? (
            <p role="status">
              {config.venue.phone
                ? t("party.largePhone", { n: config.maxPartySize, phone: config.venue.phone })
                : t("party.large", { n: config.maxPartySize })}
            </p>
          ) : (
            <fieldset className="space-y-2" aria-describedby={errors.time ? `${ids}-time-error` : undefined}>
              <legend className="font-medium">{t("field.time")}</legend>
              <TimeList
                times={times}
                t={t}
                party={party}
                name={`${ids}-time`}
                value={time}
                onChange={(value) => {
                  setTime(value);
                  setErrors({});
                }}
                explain={(failure) => noticeText(explain(failure))}
              />
              {errors.time && (
                <p id={`${ids}-time-error`} className="text-danger">
                  {t(errors.time)}
                </p>
              )}
            </fieldset>
          )}

          {party !== "more" && (
            <button type="submit" className={primaryButton}>
              {t("action.continue")}
            </button>
          )}
        </form>
      </Section>
    );
  }

  const partySize = party === "more" ? 0 : party;
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
            onChange={(e) => setName(e.target.value)}
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
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
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
              setStep("choose");
            }}
          >
            {t("action.back")}
          </button>
          <button type="submit" className={primaryButton} disabled={sending !== null}>
            {t("action.book")}
          </button>
        </div>
      </form>
    </Section>
  );
}

export function TimeList(props: {
  times: Times;
  t: Translate;
  party: number;
  name: string;
  value: string;
  onChange(value: string): void;
  explain(failure: Failure): string;
}) {
  const { times, t } = props;
  if (times.kind === "pick-date") return <p className="text-muted">{t("times.pickDate")}</p>;
  if (times.kind === "closed") return <p role="status">{t("times.closed")}</p>;
  if (times.kind === "loading") return <p role="status">{t("times.loading")}</p>;
  if (times.kind === "failed") return <p role="status">{props.explain(times.failure)}</p>;
  if (times.times.length === 0) {
    if (times.reason === "past_date") return <p role="status">{t("times.pastDate")}</p>;
    if (times.reason === "beyond_horizon") return <p role="status">{t("times.tooFar")}</p>;
    return <p role="status">{t("times.none", { n: props.party })}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {times.times.map((time) => (
        <label key={time} className="relative">
          <input
            type="radio"
            name={props.name}
            value={time}
            checked={props.value === time}
            onChange={() => props.onChange(time)}
            className="peer absolute inset-0 opacity-0"
          />
          <span
            className={
              "inline-flex min-h-11 min-w-16 items-center justify-center rounded-oc border border-border bg-surface " +
              "px-3 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-primary " +
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
            }
          >
            {time}
          </span>
        </label>
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
