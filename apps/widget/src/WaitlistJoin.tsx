import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { waitlistEntryUrl, type Joined, type PublicApi, type PublicConfig, type WaitlistFields } from "./api";
import { formatDate } from "./dates";
import { explainWaitlist, type Explanation } from "./errors";
import type { Translate } from "./messages";
import { createSubmitter, type Ticket } from "./submit";
import { noticeHref } from "./theme";
import { Field, inputClass, primaryButton, secondaryButton, Section } from "./ui";
import { checkWaitlist, withoutError, type WaitlistErrors } from "./validate";

// The public waitlist join (ADR-0021 section 3, stage 12), offered on a full day. The consent label is PROVISIONAL:
// it is the Spanish proposal of docs/legal-review-waitlist.md, translated, and waits for the legal review (Q11).
// The box is never pre-ticked and the join cannot be sent until it is.

const fingerprint = (f: WaitlistFields) =>
  JSON.stringify([f.date, f.partySize, f.name.trim(), f.email.trim(), f.window?.from ?? "", f.window?.to ?? "", f.emailConsent, f.honeypot]);

/** The "this day is full" panel under the times, with the way into the join. */
export function WaitlistOffer({ t, party, onJoin }: { t: Translate; party: number; onJoin(): void }) {
  return (
    <div className="space-y-2 rounded-oc border border-border bg-surface p-3">
      <p className="font-medium">{t("waitlist.fullTitle")}</p>
      <p className="text-muted">{t("waitlist.fullBody", { n: party })}</p>
      <button type="button" className={primaryButton} onClick={onJoin}>
        {t("waitlist.join")}
      </button>
    </div>
  );
}

export function WaitlistJoin(props: {
  api: Pick<PublicApi, "joinWaitlist">;
  t: Translate;
  locale: string;
  config: PublicConfig;
  date: string;
  party: number;
  takeTicket(): Promise<Ticket | null>;
  /** How many proof-of-work attempts have run, for the progress line. */
  tries: number;
  newKey(): string;
  onBack(): void;
  onJoined(joined: Joined): void;
}) {
  const { api, t, locale, config, date, party, onBack, onJoined } = props;
  const ids = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<WaitlistErrors>({});
  const [notice, setNotice] = useState<Explanation | null>(null);
  const [phase, setPhase] = useState<null | "checking" | "sending">(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  const submit = useMemo(
    () =>
      createSubmitter<WaitlistFields, Joined>({
        takeTicket: props.takeTicket,
        newKey: props.newKey,
        fingerprint,
        send: (key, fields, ticket) => {
          setPhase("sending");
          return api.joinWaitlist(key, fields, ticket.challenge, ticket.solution);
        },
      }),
    [api, props.takeTicket, props.newKey],
  );

  async function join(event: FormEvent) {
    event.preventDefault();
    if (phase || !consent) return;
    const found = checkWaitlist(name, email, from, to);
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.email) return emailRef.current?.focus();
    if (found.window) return fromRef.current?.focus();
    setNotice(null);
    setPhase("checking");
    const result = await submit({
      date,
      partySize: party,
      name,
      email,
      window: from && to ? { from, to } : null,
      emailConsent: consent,
      honeypot,
    });
    setPhase(null);
    if (result.ok) return onJoined(result.value);
    setNotice(explainWaitlist(result.failure));
  }

  const privacyHref = noticeHref(config.privacyNoticeUrl);
  const progress = Math.min(99, Math.floor((props.tries / 2 ** config.challenge.difficulty) * 100));
  const partyLabel = party === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n: party });
  const noticeText = (e: Explanation) =>
    e.phone && config.venue.phone ? t("waitlist.error.genericPhone", { phone: config.venue.phone }) : t(e.message);

  return (
    <Section title={t("step.waitlist")} focus>
      <p className="rounded-oc bg-surface p-3">{`${formatDate(date, locale)}, ${partyLabel}`}</p>
      <p className="text-muted">{t("waitlist.intro")}</p>
      <div role="alert" className={notice ? "rounded-oc border border-danger p-3 text-danger" : undefined}>
        {notice ? noticeText(notice) : null}
      </div>
      <form className="space-y-4" onSubmit={join} noValidate aria-busy={phase !== null}>
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
        <Field id={`${ids}-email`} label={t("waitlist.email")} hint={t("waitlist.emailHint")} error={errors.email && t(errors.email)}>
          <input
            ref={emailRef}
            id={`${ids}-email`}
            type="text"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((current) => withoutError(current, "email"));
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={`${ids}-email-hint${errors.email ? ` ${ids}-email-error` : ""}`}
            className={inputClass}
          />
        </Field>
        <fieldset className="space-y-2" aria-describedby={`${ids}-window-hint${errors.window ? ` ${ids}-window-error` : ""}`}>
          <legend className="font-medium">{t("waitlist.windowTitle")}</legend>
          <p id={`${ids}-window-hint`} className="text-sm text-muted">
            {t("waitlist.windowHint")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${ids}-from`} className="block">
                {t("waitlist.from")}
              </label>
              <input
                ref={fromRef}
                id={`${ids}-from`}
                type="time"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setErrors((current) => withoutError(current, "window"));
                }}
                aria-invalid={errors.window ? true : undefined}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${ids}-to`} className="block">
                {t("waitlist.to")}
              </label>
              <input
                id={`${ids}-to`}
                type="time"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setErrors((current) => withoutError(current, "window"));
                }}
                aria-invalid={errors.window ? true : undefined}
                className={inputClass}
              />
            </div>
          </div>
          {errors.window && (
            <p id={`${ids}-window-error`} className="text-sm text-danger">
              {t(errors.window)}
            </p>
          )}
        </fieldset>
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
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>{t("waitlist.consent", { venue: config.venue.name })}</span>
        </label>
        {privacyHref && (
          <p>
            <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 py-2 underline [overflow-wrap:anywhere]">
              {t("notice.privacy")}
            </a>
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-6 text-muted">
          {phase === "checking" && t("waitlist.checking", { percent: progress })}
          {phase === "sending" && t("waitlist.sending")}
        </p>
        <div className="flex gap-3">
          <button type="button" className={secondaryButton} disabled={phase !== null} onClick={onBack}>
            {t("action.back")}
          </button>
          <button type="submit" className={primaryButton} disabled={phase !== null || !consent}>
            {t("waitlist.submit")}
          </button>
        </div>
      </form>
    </Section>
  );
}

/** What the guest sees after joining: the entry, that it is not a booking, and the leave link, shown once. */
export function WaitlistJoined({ t, locale, joined }: { t: Translate; locale: string; joined: Joined }) {
  const { entry, waitlistToken } = joined;
  const [copied, setCopied] = useState(false);
  const ids = useId();
  const link = waitlistToken ? waitlistEntryUrl(window.location.origin, waitlistToken, locale) : null;
  const party = entry.partySize === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n: entry.partySize });
  return (
    <Section title={t("waitlist.done.title")} focus>
      <p>{t("waitlist.done.body", { date: formatDate(entry.date, locale), party, venue: entry.venue.name })}</p>
      {entry.window && <p>{t("waitlist.done.window", { from: entry.window.from, to: entry.window.to })}</p>}
      <p className="font-medium">{t("waitlist.done.notBooking")}</p>
      <p className="text-muted">{t("waitlist.done.email", { contact: entry.guest.contact })}</p>
      {link ? (
        <div className="space-y-2 rounded-oc border border-border bg-surface p-3">
          <label htmlFor={`${ids}-link`} className="block font-medium">
            {t("waitlist.done.linkTitle")}
          </label>
          <p id={`${ids}-link-hint`} className="text-sm text-muted">
            {t("waitlist.done.linkBody")}
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
        <p>{t("waitlist.done.noLink")}</p>
      )}
    </Section>
  );
}
