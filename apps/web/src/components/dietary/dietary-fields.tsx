import { useCallback, useEffect, useId, useRef, useState, type Ref, type RefObject } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { isTooLong, LimitedTextarea } from "@/components/limited-textarea";
import { useT } from "@/i18n";
import {
  ALLERGENS,
  DIETARY_NOTE_MAX,
  DIETS,
  dietaryChange,
  draftFrom,
  isEmptyDietary,
  type Dietary,
  type DietaryDraft,
  type DietaryInput,
} from "@/lib/dietary";

export interface DietaryForm {
  stored?: Dietary;
  draft: DietaryDraft;
  /** A save was tried without the tick. */
  consentMissing: boolean;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  edit: (patch: Partial<DietaryDraft>) => void;
  reset: (stored?: Dietary) => void;
  /** The `dietary` to put in a request body, to be spread into it. Null means do not send the request yet. */
  take: () => { dietary?: DietaryInput | null } | null;
}

export function useDietaryForm(): DietaryForm {
  const [state, setState] = useState<{ stored?: Dietary; draft: DietaryDraft; consentMissing: boolean }>(() => ({
    draft: draftFrom(),
    consentMissing: false,
  }));
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const reset = useCallback((stored?: Dietary) => setState({ stored, draft: draftFrom(stored), consentMissing: false }), []);
  return {
    ...state,
    noteRef,
    reset,
    edit: (patch) =>
      setState((prev) => {
        const draft = { ...prev.draft, ...patch };
        // With nothing left to attest, an earlier tick must not carry over to what is written next.
        if (dietaryChange({ ...draft, consented: false }, prev.stored).kind !== "needsConsent") draft.consented = false;
        return { ...prev, draft, consentMissing: false };
      }),
    take: () => {
      if (isTooLong(state.draft.note, DIETARY_NOTE_MAX)) {
        noteRef.current?.focus();
        return null;
      }
      const change = dietaryChange(state.draft, state.stored);
      if (change.kind === "needsConsent") {
        setState((prev) => ({ ...prev, consentMissing: true }));
        return null;
      }
      if (change.kind === "unchanged") return {};
      return { dietary: change.kind === "set" ? change.value : null };
    },
  };
}

export function DietaryFields({ form }: { form: DietaryForm }) {
  const t = useT();
  const id = useId();
  const { draft, stored, consentMissing, noteRef, edit } = form;
  const [asked, setAsked] = useState(false);
  const open = asked || Boolean(stored) || !isEmptyDietary(draft);
  const first = useRef<HTMLButtonElement>(null);
  const tick = useRef<HTMLInputElement>(null);
  const needsTick = dietaryChange({ ...draft, consented: false }, stored).kind === "needsConsent";

  // The button that opened the fields is gone, so focus goes to the first of them.
  useEffect(() => {
    if (asked) first.current?.focus();
  }, [asked]);

  useEffect(() => {
    if (consentMissing) tick.current?.focus();
  }, [consentMissing]);

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setAsked(true)}>
        <PlusIcon aria-hidden="true" />
        {t("dietary.add")}
      </Button>
    );
  }

  function chips<T extends string>(
    codes: readonly T[],
    chosen: T[],
    name: (code: T) => string,
    change: (next: T[]) => void,
    firstRef?: Ref<HTMLButtonElement>,
  ) {
    return codes.map((code, i) => {
      const on = chosen.includes(code);
      return (
        <Button
          key={code}
          ref={i === 0 ? firstRef : undefined}
          type="button"
          size="sm"
          variant={on ? "default" : "outline"}
          aria-pressed={on}
          className="h-auto min-h-10 max-w-full py-1 text-left whitespace-normal sm:h-auto sm:min-h-8 coarse:h-auto coarse:min-h-11"
          onClick={() => change(on ? chosen.filter((c) => c !== code) : [...chosen, code])}
        >
          {on && <CheckIcon aria-hidden="true" />}
          {name(code)}
        </Button>
      );
    });
  }

  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-input p-3 [&>legend]:mb-0">
      <legend className="px-1 text-sm font-medium">{t("dietary.title")}</legend>
      <p className="text-sm text-muted-foreground">{t("dietary.hint")}</p>

      <div role="group" aria-labelledby={`${id}-allergens`} className="space-y-2">
        <p id={`${id}-allergens`} className="text-sm font-medium">{t("dietary.allergens")}</p>
        <div className="flex flex-wrap gap-2">
          {chips(ALLERGENS, draft.allergens, (code) => t(`dietary.allergen.${code}`), (allergens) => edit({ allergens }), first)}
        </div>
      </div>

      <div role="group" aria-labelledby={`${id}-diets`} className="space-y-2">
        <p id={`${id}-diets`} className="text-sm font-medium">{t("dietary.diets")}</p>
        <div className="flex flex-wrap gap-2">
          {chips(DIETS, draft.diets, (code) => t(`dietary.diet.${code}`), (diets) => edit({ diets }))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-note`}>{t("dietary.note")}</Label>
        <LimitedTextarea
          id={`${id}-note`}
          ref={noteRef}
          text={draft.note}
          limit={DIETARY_NOTE_MAX}
          hint={t("dietary.noteHint", { max: DIETARY_NOTE_MAX })}
          autoComplete="off"
          value={draft.note}
          onChange={(e) => edit({ note: e.target.value })}
        />
      </div>

      {needsTick && (
        <div className="space-y-1">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
            <input
              ref={tick}
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              checked={draft.consented}
              aria-invalid={consentMissing || undefined}
              aria-describedby={consentMissing ? `${id}-consent-error` : undefined}
              onChange={(e) => edit({ consented: e.target.checked })}
            />
            {t("dietary.consent")}
          </label>
          {consentMissing && (
            <p id={`${id}-consent-error`} role="alert" className="text-sm text-destructive">
              {t("dietary.consentRequired")}
            </p>
          )}
        </div>
      )}

      {stored && isEmptyDietary(draft) && (
        <p role="status" className="text-sm font-medium text-destructive">
          {t("dietary.willDelete")}
        </p>
      )}
    </fieldset>
  );
}
