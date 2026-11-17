import { useId, useRef, useState, type FormEvent } from "react";
import type { PublicApi } from "./api";
import { explainResend } from "./errors";
import type { MessageId, Translate } from "./messages";
import { Field, inputClass, secondaryButton } from "./ui";
import { emailLooksValid } from "./validate";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "answered"; message: MessageId };

/** "Lost your link?" under the booking form (ADR-0017 stage 12). Closed until the guest opens it. */
export function LostLink({ api, t }: { api: Pick<PublicApi, "resendLink">; t: Translate }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (state.kind === "sending") return;
    if (!emailLooksValid(email)) {
      setInvalid(true);
      return input.current?.focus();
    }
    setInvalid(false);
    setState({ kind: "sending" });
    setState({ kind: "answered", message: explainResend(await api.resendLink(email)) });
  }

  return (
    <div className="mt-8 border-t border-border pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${ids}-panel`}
        onClick={() => setOpen(!open)}
        className="min-h-11 text-left underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t("lost.open")}
      </button>
      <div id={`${ids}-panel`} hidden={!open} className="mt-3 space-y-3">
        <p className="text-muted">{t("lost.body")}</p>
        <form className="space-y-3" onSubmit={send} noValidate aria-busy={state.kind === "sending"}>
          <Field id={`${ids}-email`} label={t("lost.email")} error={invalid ? t("validate.email") : undefined}>
            <input
              ref={input}
              id={`${ids}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? `${ids}-email-error` : undefined}
              className={inputClass}
            />
          </Field>
          <button type="submit" className={`${secondaryButton} w-full`} disabled={state.kind === "sending"}>
            {state.kind === "sending" ? t("lost.sending") : t("lost.send")}
          </button>
          <p role="status" aria-live="polite" className="min-h-6">
            {state.kind === "answered" ? t(state.message) : ""}
          </p>
        </form>
      </div>
    </div>
  );
}
