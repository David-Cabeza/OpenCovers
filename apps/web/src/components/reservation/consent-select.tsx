import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t, useT } from "@/i18n";
import type { Consent } from "@/lib/api";

// `label` is a getter, so the text is read when it is shown and follows the language.
export const CONSENT_OPTIONS: { value: Consent; readonly label: string }[] = [
  { value: "unknown", get label() { return t("common.consent.unknown"); } },
  { value: "granted", get label() { return t("common.consent.granted"); } },
  { value: "denied", get label() { return t("common.consent.denied"); } },
];

export function ConsentSelect({
  id,
  value,
  onChange,
}: {
  /** The id a `<Label htmlFor>` points at, so the select has a name of its own. */
  id: string;
  value: Consent;
  onChange: (value: Consent) => void;
}) {
  useT();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Consent)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CONSENT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
