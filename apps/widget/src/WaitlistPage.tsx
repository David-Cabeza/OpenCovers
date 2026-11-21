import { useEffect, useMemo, useState } from "react";
import type { PublicWaitlistEntry, WaitlistApi } from "./api";
import { formatDate } from "./dates";
import { explainWaitlistPage, type Explanation } from "./errors";
import { localeOf, translator, type Locale, type MessageId, type Translate } from "./messages";
import { createKeyedAction } from "./submit";
import { watchTheme } from "./theme";
import { dangerButton, secondaryButton, Section, VenueHeader } from "./ui";

// The waitlist page at /r/waitlist (ADR-0021 section 3, stage 12). The token was read from the fragment before this
// renders and reaches this file only inside `api`, which only calls the waitlist routes.

type Page =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "unreachable"; notice: Explanation }
  | { kind: "open"; view: PublicWaitlistEntry }
  | { kind: "left"; view: PublicWaitlistEntry }
  | { kind: "expired"; view: PublicWaitlistEntry };

const STATUS: Record<PublicWaitlistEntry["status"], MessageId> = {
  waiting: "waitlist.manage.status.waiting",
  seated: "waitlist.manage.status.seated",
  cancelled: "waitlist.manage.status.cancelled",
};

export function WaitlistPage(props: {
  api: WaitlistApi | null;
  fixedLocale: Locale | null;
  initialLocale: Locale;
  newKey(): string;
  now?: () => number;
}) {
  const { api, fixedLocale, newKey } = props;
  const now = props.now ?? Date.now;
  const [page, setPage] = useState<Page>(api ? { kind: "loading" } : { kind: "invalid" });
  const [locale, setLocale] = useState<Locale>(fixedLocale ?? props.initialLocale);
  const t = useMemo(() => translator(locale), [locale]);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Explanation | null>(null);

  const show = (view: PublicWaitlistEntry) => {
    if (!fixedLocale) setLocale(localeOf(view.venue.locale));
    watchTheme(view.venue.theme, window);
    if (view.status === "cancelled") return setPage({ kind: "left", view });
    // The engine refuses an expired link with the identical 404; this covers a page that stayed open past the end of the date.
    if (Date.parse(view.linkExpiresAt) <= now()) return setPage({ kind: "expired", view });
    setPage({ kind: "open", view });
  };

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.read().then((result) => {
      if (!live) return;
      if (result.ok) return show(result.value);
      const outcome = explainWaitlistPage(result.failure);
      setPage(outcome.kind === "notice" ? { kind: "unreachable", notice: outcome.notice } : { kind: "invalid" });
    });
    return () => {
      live = false;
    };
    // `show` reads only setters and `fixedLocale`, which never changes.
  }, [api, attempt]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = "view" in page ? t("waitlist.manage.pageTitle", { venue: page.view.venue.name }) : t("waitlist.manage.title");
  }, [locale, page, t]);

  const leave = useMemo(() => (api ? createKeyedAction({ newKey, send: (key) => api.leave(key) }) : null), [api, newKey]);

  async function confirmLeave() {
    if (busy || !api || !leave) return;
    setNotice(null);
    setBusy(true);
    const result = await leave(undefined);
    setBusy(false);
    if (result.ok) return show(result.value);
    const outcome = explainWaitlistPage(result.failure);
    if (outcome.kind === "invalid") return setPage({ kind: "invalid" });
    if (outcome.kind === "notice") return setNotice(outcome.notice);
    // Staff seated or cancelled the entry meanwhile: read it again and show what it is now.
    const reread = await api.read();
    if (reread.ok) show(reread.value);
    else if (explainWaitlistPage(reread.failure).kind === "invalid") setPage({ kind: "invalid" });
  }

  const callVenue = (view: PublicWaitlistEntry) =>
    view.venue.phone ? t("waitlist.error.genericPhone", { phone: view.venue.phone }) : "";

  return (
    <main className="mx-auto w-full max-w-md p-4 text-text">
      {"view" in page && <VenueHeader venue={page.view.venue} />}
      {page.kind === "loading" && <p role="status">{t("loading")}</p>}
      {page.kind === "invalid" && (
        <Section title={t("waitlist.manage.invalidTitle")} focus>
          <p>{t("waitlist.manage.invalidBody")}</p>
        </Section>
      )}
      {page.kind === "unreachable" && (
        <Section title={t("waitlist.manage.title")}>
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
      {page.kind === "left" && (
        <Section title={t("waitlist.manage.leftTitle")} focus>
          <p role="status">{t("waitlist.manage.leftBody", { date: formatDate(page.view.date, locale) })}</p>
        </Section>
      )}
      {page.kind === "expired" && (
        <Section title={t("waitlist.manage.expiredTitle")} focus>
          <p role="status">{t("waitlist.manage.expiredBody")}</p>
        </Section>
      )}
      {page.kind === "open" && (
        <Section title={t("waitlist.manage.title")}>
          <Entry t={t} locale={locale} view={page.view} />
          {notice && (
            <p role="alert" className="rounded-oc border border-danger p-3 text-danger">
              {notice.phone && page.view.venue.phone ? callVenue(page.view) : t(notice.message)}
            </p>
          )}
          <p className="text-muted">{t("waitlist.done.notBooking")}</p>
          {page.view.status === "waiting" && (
            <>
              <p role="status" aria-live="polite" className="min-h-6 text-muted">
                {busy ? t("waitlist.manage.leaving") : ""}
              </p>
              <button type="button" className={dangerButton} disabled={busy} onClick={() => void confirmLeave()}>
                {t("waitlist.manage.leave")}
              </button>
            </>
          )}
        </Section>
      )}
    </main>
  );
}

function Entry({ t, locale, view }: { t: Translate; locale: string; view: PublicWaitlistEntry }) {
  const rows: [MessageId, string][] = [
    ["manage.venue", view.venue.name],
    ["field.date", formatDate(view.date, locale)],
    ["waitlist.manage.window", view.window ? `${view.window.from} – ${view.window.to}` : t("waitlist.manage.windowAny")],
    ["field.party", view.partySize === 1 ? t("field.partyOptionOne") : t("field.partyOption", { n: view.partySize })],
    ["manage.contact", view.guest.contact],
    ["manage.status", t(STATUS[view.status])],
  ];
  return (
    <dl className="divide-y divide-border rounded-oc border border-border bg-surface">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 p-3">
          <dt className="text-muted">{t(label)}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
