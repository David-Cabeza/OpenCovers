import { useEffect, useState, type FormEvent } from "react";
import { MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import {
  DEMO_CONSENT_TEXT,
  DEMO_PRIVACY_URL,
  demoSignInHeaders,
} from "@/lib/demo";
import { authErrorMessage } from "@/lib/error-message";
import { isServerUnreachable, SERVER_UNREACHABLE } from "@/lib/server-status";

/** One magic link per address per minute (ADR-0022, decision 8). */
const RESEND_WINDOW_S = 60;

const FALLBACK = "Could not send the link. Try again.";

export function DemoSignIn({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function send(address: string) {
    setBusy(true);
    setError(null);
    let retryAfter = 0;
    try {
      const { error: failure } = await authClient.signIn.magicLink(
        { email: address, callbackURL: `${window.location.origin}/` },
        {
          headers: demoSignInHeaders(consent),
          onError: (ctx: { response: Response }) => {
            retryAfter = Number(ctx.response.headers.get("retry-after")) || 0;
          },
        },
      );
      if (failure) {
        setError(authErrorMessage(failure, FALLBACK));
        if (failure.status === 429) setWait(retryAfter || RESEND_WINDOW_S);
        return;
      }
      setSentTo(address);
      setWait(RESEND_WINDOW_S);
    } catch (err) {
      setError(isServerUnreachable(err) ? SERVER_UNREACHABLE : FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await authClient.signIn.social(
        { provider: "google", callbackURL: `${window.location.origin}/` },
        { headers: demoSignInHeaders(consent) },
      );
      if (failure) setError(authErrorMessage(failure, "Could not start Google sign-in."));
    } catch (err) {
      setError(isServerUnreachable(err) ? SERVER_UNREACHABLE : "Could not start Google sign-in.");
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
          <h2 className="font-medium">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a sign-in link to <strong className="text-foreground">{sentTo}</strong>. It expires in 5
            minutes. If it does not arrive, check your spam folder.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || wait > 0} onClick={() => void send(sentTo)}>
            {wait > 0 ? `Send again in ${wait}s` : "Send the link again"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            Use another email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="demo-email">Email</Label>
          <Input
            id="demo-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <Consent checked={consent} onChange={setConsent} />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || wait > 0 || email.trim() === ""}>
          {busy ? "Sending…" : wait > 0 ? `Try again in ${wait}s` : "Email me a sign-in link"}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <p className="text-center text-xs text-muted-foreground">or</p>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void google()}>
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}

function Consent({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{DEMO_CONSENT_TEXT}</span>
      </label>
      <p className="pl-6 text-xs text-muted-foreground">
        Optional. The demo works the same either way.{" "}
        <a href={DEMO_PRIVACY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Privacy notice
        </a>
        .
      </p>
    </div>
  );
}
