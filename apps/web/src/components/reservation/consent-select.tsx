import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Consent } from "@/lib/api";

const OPTIONS: { value: Consent; label: string }[] = [
  { value: "unknown", label: "Not asked" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
];

export function ConsentSelect({
  value,
  onChange,
}: {
  value: Consent;
  onChange: (value: Consent) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Consent)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
