import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Consent } from "@/lib/api";

export const CONSENT_OPTIONS: { value: Consent; label: string }[] = [
  { value: "unknown", label: "Not asked" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
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
