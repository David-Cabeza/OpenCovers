import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { isChangeable, type Failure, type GuestChanges, type PublicReservation, type SelfServiceApi } from "./api";
import { formatDate, formatInstant } from "./dates";
import { explainSelfService, type Explanation } from "./errors";
import { localeOf, translator, type Locale, type MessageId, type Translate } from "./messages";
import { createKeyedAction } from "./submit";
import { watchTheme } from "./theme";
import { dangerButton, Field, inputClass, primaryButton, secondaryButton, Section, VenueHeader } from "./ui";

// The self-service page at /r (ADR-0017 section 2, stage 6). The token was read from the fragment before this
// renders and reaches this file only inside `api`.

type Page =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unreachable"; notice: Explanation }
  | { kind: "open"; view: PublicReservation; closed: boolean }
  | { kind: "cancelled"; view: PublicReservation };

type Mode = "view" | "edit" | "cancel";

type Notice = Explanation & { ok?: boolean };


export function ManagePage(props: {
  api: SelfServiceApi | null;
  /** A supported `?lang=`, which wins over the venue's locale. */
  fixedLocale: Locale | null;
  initialLocale: Locale;
  newKey(): string;
}) {
  const { api, fixedLocale, newKey } = props;
  const [page, setPage] = useState<Page>(api ? { kind: "loading" } : { kind: "invalid" });
  const [locale, setLocale] = useState<Locale>(fixedLocale ?? props.initialLocale);
  const t = useMemo(() => translator(locale), [locale]);
  const [attempt, setAttempt] = useState(0);

  const show = (view: PublicReservation, closedByEngine = false) => {
    if (!fixedLocale) setLocale(localeOf(view.venue.locale));
    watchTheme(view.venue.theme, window);
    setPage({ kind: "open", view, closed: closedByEngine || !isChangeable(view) });
  };

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.read().then((result) => {
      if (!live) return;
      if (result.ok) return show(result.value);
      const outcome = explainSelfService(result.failure);
      setPage(outcome.kind === "notice" ? { kind: "unreachable", notice: outcome.notice } : { kind: "invalid" });
    });
    return () => {
      live = false;
    };
    // `show` reads only setters and `fixedLocale`, which never changes, so it is left out of the dependencies.
  }, [api, attempt]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      page.kind === "open" || page.kind === "cancelled"
        ? t("manage.pageTitle", { venue: page.view.venue.name })
        : t("manage.title");
  }, [locale, page, t]);

  return (
    <main className="mx-auto w-full max-w-md p-4 text-text">
      {"view" in page && <VenueHeader venue={page.view.venue} />}
      {page.kind === "loading" && <p role="status">{t("loading")}</p>}
      {page.kind === "invalid" && (
        <Section title={t("manage.invalidTitle")} focus>
          <p>{t("manage.invalidBody")}</p>
        </Section>
      )}
      {page.kind === "unreachable" && (
        <Section title={t("manage.title")}>
          <p role="alert">{t(page.notice.message)}</p>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setPage({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {t("manage.retry")}
          </button>
        </Section>
      )}
      {page.kind === "open" && api && (
        <OpenBooking
          api={api}
          t={t}
          locale={locale}
          view={page.view}
          closed={page.closed}
          newKey={newKey}
          onView={show}
          onInvalid={() => setPage({ kind: "invalid" })}
          onCancelled={(view) => setPage({ kind: "cancelled", view })}
        />
      )}
      {page.kind === "cancelled" && (
        <Section title={t("manage.cancelledTitle")} focus>
          <p role="status">
            {t("manage.cancelledBody", { date: formatDate(page.view.date, locale), time: page.view.time })}
          </p>
        </Section>
      )}
    </main>
  );
}

function OpenBooking(props: {
  api: SelfServiceApi;
  t: Translate;
  locale: Locale;
  view: PublicReservation;
  closed: boolean;
  newKey(): string;
  onView(view: PublicReservation, closedByEngine?: boolean): void;
  onInvalid(): void;
  onCancelled(view: PublicReservation): void;
}) {
  const { api, t, locale, view, closed, newKey, onView, onInvalid, onCancelled } = props;
  const ids = useId();
  const [mode, setModeState] = useState<Mode>("view");
  const [moved, setMoved] = useState(false);
  const setMode = (next: Mode) => {
    setMoved(true);
    setModeState(next);
  };
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const maxParty = Math.max(view.maxPartySize, view.partySize);
  const [party, setParty] = useState(view.partySize);
  const [note, setNote] = useState(view.commentary);

  useEffect(() => {
    setParty(view.partySize);
    setNote(view.commentary);
  }, [view]);

  const modify = useMemo(
    () =>
      createKeyedAction({
        newKey,
        send: (key, payload: { version: number; changes: GuestChanges }) =>
          api.modify(key, payload.version, payload.changes),
      }),
    [api, newKey],
  );
  const cancel = useMemo(() => createKeyedAction({ newKey, send: (key) => api.cancel(key) }), [api, newKey]);

  const callVenue = view.venue.phone ? t("manage.callPhone", { phone: view.venue.phone }) : t("manage.call");
  const partyLabel = (n: number) => (n === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n }));

  async function reread(closedByEngine: boolean) {
    const result = await api.read();
    if (result.ok) onView(result.value, closedByEngine);
    else if (explainSelfService(result.failure).kind === "invalid") onInvalid();
  }

  async function fail(failure: Failure) {
    const outcome = explainSelfService(failure);
    if (outcome.kind === "invalid") return onInvalid();
    if (outcome.kind === "notice") return setNotice(outcome.notice);
    await reread(outcome.kind === "closed");
    setMode("view");
    if (outcome.kind === "changed") setNotice({ message: "manage.changed" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const changes: GuestChanges = {};
    if (party !== view.partySize) changes.partySize = party;
    if (note.trim() !== view.commentary) changes.commentary = note.trim();
    if (Object.keys(changes).length === 0) return setNotice({ message: "manage.nothingChanged" });
    setNotice(null);
    setBusy(true);
    const result = await modify({ version: view.version, changes });
    setBusy(false);
    if (!result.ok) return fail(result.failure);
    onView(result.value);
    setMode("view");
    setNotice({ message: "manage.saved", ok: true });
  }

  async function confirmCancel() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    const result = await cancel(undefined);
    setBusy(false);
    if (result.ok) return onCancelled(result.value);
    await fail(result.failure);
  }

  const noticeView = (
    <div
      role={notice?.ok ? "status" : "alert"}
      className={
        notice ? `rounded-oc border p-3 ${notice.ok ? "border-border bg-surface" : "border-danger text-danger"}` : undefined
      }
    >
      {notice && (
        <>
          {t(notice.message)}
          {notice.phone ? ` ${callVenue}` : ""}
        </>
      )}
    </div>
  );

  if (mode === "edit") {
    return (
      <Section title={t("manage.editTitle")} focus>
        {noticeView}
        <form className="space-y-4" onSubmit={save} noValidate aria-busy={busy}>
          <div className="space-y-1">
            <label htmlFor={`${ids}-party`} className="block font-medium">
              {t("field.party")}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={secondaryButton}
                aria-label={t("manage.partyLess")}
                aria-controls={`${ids}-party`}
                disabled={busy || party <= 1}
                onClick={() => setParty((n) => Math.max(1, n - 1))}
              >
                −
              </button>
              <input
                id={`${ids}-party`}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxParty}
                value={party}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(n)) setParty(Math.min(maxParty, Math.max(1, n)));
                }}
                className={`${inputClass} w-20 text-center`}
              />
              <button
                type="button"
                className={secondaryButton}
                aria-label={t("manage.partyMore")}
                aria-controls={`${ids}-party`}
                disabled={busy || party >= maxParty}
                onClick={() => setParty((n) => Math.min(maxParty, n + 1))}
              >
                +
              </button>
            </div>
          </div>
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
          <p className="text-sm text-muted">{t("manage.moveHint")}</p>
          <p role="status" aria-live="polite" className="min-h-6 text-muted">
            {busy ? t("manage.saving") : ""}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                setNotice(null);
                setParty(view.partySize);
                setNote(view.commentary);
                setMode("view");
              }}
            >
              {t("action.back")}
            </button>
            <button type="submit" className={primaryButton} disabled={busy}>
              {t("manage.save")}
            </button>
          </div>
        </form>
      </Section>
    );
  }

  if (mode === "cancel") {
    return (
      <Section title={t("manage.cancelTitle")} focus>
        <p>
          {t("manage.whenValue", { date: formatDate(view.date, locale), time: view.time })}, {partyLabel(view.partySize)}
        </p>
        <p>{t("manage.cancelBody")}</p>
        {noticeView}
        <p role="status" aria-live="polite" className="min-h-6 text-muted">
          {busy ? t("manage.cancelling") : ""}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              setNotice(null);
              setMode("view");
            }}
          >
            {t("manage.cancelKeep")}
          </button>
          <button
            type="button"
            className={dangerButton}
            disabled={busy}
            onClick={() => void confirmCancel()}
          >
            {t("manage.cancelConfirm")}
          </button>
        </div>
      </Section>
    );
  }

  const rows: [MessageId, string][] = [
    ["manage.venue", view.venue.name],
    ["manage.when", t("manage.whenValue", { date: formatDate(view.date, locale), time: view.time })],
    ["field.party", partyLabel(view.partySize)],
    ["manage.name", view.guest.name],
    ["manage.contact", view.guest.contact],
    ["manage.note", view.commentary || t("manage.noNote")],
    ["manage.status", statusLabel(t, view.status)],
  ];
  return (
    <Section title={view.status === "cancelled" ? t("manage.cancelledTitle") : t("manage.title")} focus={moved}>
      {noticeView}
      <dl className="divide-y divide-border rounded-oc border border-border bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 p-3">
            <dt className="text-muted">{t(label)}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {closed ? (
        <p role="status">
          {t("manage.closed")} {callVenue}
        </p>
      ) : (
        <>
          <p className="text-muted">
            {t("manage.changeableUntil", { when: formatInstant(view.changeableUntil, locale) })}
          </p>
          <p className="text-sm text-muted">{t("manage.moveHint")}</p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setNotice(null);
                setMode("edit");
              }}
            >
              {t("manage.edit")}
            </button>
            <button
              type="button"
              className={`${secondaryButton} w-full`}
              onClick={() => {
                setNotice(null);
                setMode("cancel");
              }}
            >
              {t("manage.cancel")}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

const STATUS_LABELS: Record<string, MessageId> = {
  booked: "manage.status.booked",
  seated: "manage.status.seated",
  attended: "manage.status.attended",
  no_show: "manage.status.no_show",
  cancelled: "manage.status.cancelled",
};

const statusLabel = (t: Translate, status: string) => (STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status);
