import { TriangleAlertIcon, UtensilsIcon } from "lucide-react";
import { cn } from "cn";
import { useT } from "@/i18n";
import { isAllergyRisk, type Dietary } from "@/lib/dietary";

/**
 * The recorded allergies and diets, in full: never cut short, and told apart by an icon, words and a border, not by
 * colour alone (a printed sheet drops backgrounds). Draws only a recorded value, so it never says there is none.
 */
export function DietarySummary({ dietary, className }: { dietary: Dietary; className?: string }) {
  const t = useT();
  const risk = isAllergyRisk(dietary);
  const Icon = risk ? TriangleAlertIcon : UtensilsIcon;
  return (
    <div
      data-slot="dietary"
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground",
        risk ? "border-2 border-destructive bg-danger-soft" : "border border-input",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", risk && "text-destructive")} aria-hidden="true" />
      <div className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
        {dietary.allergens.length > 0 && (
          <p className="font-semibold">
            {t("dietary.shown.allergens", { list: dietary.allergens.map((code) => t(`dietary.allergen.${code}`)).join(", ") })}
          </p>
        )}
        {dietary.diets.length > 0 && (
          <p>
            {t("dietary.shown.diets", {
              count: dietary.diets.length,
              list: dietary.diets.map((code) => t(`dietary.diet.${code}`)).join(", "),
            })}
          </p>
        )}
        {dietary.note && <p className="whitespace-pre-line">{t("dietary.shown.note", { note: dietary.note })}</p>}
      </div>
    </div>
  );
}
