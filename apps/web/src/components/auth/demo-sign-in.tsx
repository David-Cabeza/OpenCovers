import { useEffect, useRef, useState, type FormEvent } from "react";
import { MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useT, currentLocale, type Translate } from "@/i18n";
import { DEMO_PRIVACY_URL, DemoRequestError, rememberConsent, solvedChallengeHeaders } from "@/lib/demo";
import { authErrorMessage } from "@/lib/error-message";
import { isServerUnreachable } from "@/lib/server-status";

/** One magic link per address per minute (ADR-0022, decision 8). */
const RESEND_WINDOW_S = 60;

export function DemoSignIn({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const sentHeading = useRef<HTMLHeadingElement>(null);

  // The form is replaced by the confirmation, so keyboard focus would otherwise drop to the page.
  useEffect(() => {
    if (sentTo) sentHeading.current?.focus();
  }, [sentTo]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function send(address: string) {
    setBusy(true);
    setError(null);
    let retryAfter = 0;
    const fallback = t("demo.signIn.failed");
    try {
      // A challenge is single use and lives 5 minutes, so every send, a resend included, asks for a new one.
      const challengeHeaders = await solvedChallengeHeaders(address);
      rememberConsent(consent);
      const { error: failure } = await authClient.signIn.magicLink(
        { email: address, callbackURL: `${window.location.origin}/` },
        {
          // The magic-link mail is written in the language of Accept-Language, so it follows the selected language.
          headers: { ...challengeHeaders, "Accept-Language": currentLocale() },
          onError: (ctx: { response: Response }) => {
            retryAfter = Number(ctx.response.headers.get("retry-after")) || 0;
          },
        },
      );
      if (failure) {
        const message = authErrorMessage(failure, fallback);
        // A rejected address comes back as the validator's own English text, which is no use to a guest.
        const raw = message === failure.message && /^\[body\./.test(message);
        setError(raw ? t("demo.signIn.invalidEmail") : message);
        if (failure.status === 429) setWait(retryAfter || RESEND_WINDOW_S);
        return;
      }
      setSentTo(address);
      setWait(RESEND_WINDOW_S);
    } catch (err) {
      if (err instanceof DemoRequestError) {
        setError(authErrorMessage(err, fallback));
        if (err.status === 429) setWait(err.retryAfter || RESEND_WINDOW_S);
      } else {
        setError(isServerUnreachable(err) ? t("errors.serverUnreachable") : fallback);
      }
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      rememberConsent(consent);
      const { error: failure } = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/`,
      });
      if (failure) setError(authErrorMessage(failure, t("demo.google.failed")));
    } catch (err) {
      setError(isServerUnreachable(err) ? t("errors.serverUnreachable") : t("demo.google.failed"));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (address) void send(address);
  }

  if (sentTo) {
    return (
      <div className="space-y-4 pt-2" role="status">
        <MailCheckIcon className="size-6 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <h2 ref={sentHeading} tabIndex={-1} className="font-medium outline-none">
            {t("demo.sent.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("demo.sent.body", { email: sentTo })}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            <LinkedText text={error} />
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || wait > 0} onClick={() => void send(sentTo)}>
            {wait > 0 ? t("demo.sent.resendIn", { seconds: wait }) : t("demo.sent.resend")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            {t("demo.sent.another")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="demo-email">{t("auth.field.email")}</Label>
          <Input
            id="demo-email"
            type="email"
            autoComplete="email"
            placeholder={t("demo.signIn.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "demo-signin-error" : undefined}
          />
        </div>

        <Consent checked={consent} onChange={setConsent} t={t} />

        {error && (
          <p id="demo-signin-error" role="alert" className="text-sm text-destructive">
            <LinkedText text={error} />
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || wait > 0 || email.trim() === ""}>
          {busy ? t("demo.signIn.preparing") : wait > 0 ? t("demo.signIn.tryAgainIn", { seconds: wait }) : t("demo.signIn.submit")}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <p className="text-center text-xs text-muted-foreground">{t("demo.signIn.or")}</p>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void google()}>
            {t("demo.google")}
          </Button>
        </>
      )}
    </div>
  );
}

function Consent({ checked, onChange, t }: { checked: boolean; onChange: (next: boolean) => void; t: Translate }) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{t("demo.consent.text")}</span>
      </label>
      <p className="pl-6 text-xs text-muted-foreground">
        {t("demo.consent.optional")}{" "}
        <a href={DEMO_PRIVACY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {t("demo.consent.privacy")}
        </a>
        .
      </p>
    </div>
  );
}

/** The "demo is full" message points to opencovers.dev as plain text; make that a link. */
function LinkedText({ text }: { text: string }) {
  const [before, after] = text.split("opencovers.dev");
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <a href="https://opencovers.dev" className="underline underline-offset-2">
        opencovers.dev
      </a>
      {after}
    </>
  );
}
