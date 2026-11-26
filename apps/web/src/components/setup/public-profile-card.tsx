import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Group, SaveBar, StatusPanel } from "./form-parts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/load-error";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { usePublicProfile } from "@/hooks/use-public-profile";
import { api } from "@/lib/api";
import { errorMessage, isApiError } from "@/lib/error-message";
import {
  PRICE_RANGES,
  jsonLdUrl,
  missingForPublishing,
  parseForm,
  toForm,
  type FormErrors,
  type PublicProfile,
  type PublicProfileForm,
} from "@/lib/public-profile";

const EMPTY_FORM: PublicProfileForm = {
  publicProfileEnabled: false,
  street: "",
  locality: "",
  postalCode: "",
  region: "",
  country: "",
  phone: "",
  websiteUrl: "",
  bookingUrl: "",
  cuisine: "",
  priceRange: "",
  latitude: "",
  longitude: "",
};

type TextKey = Exclude<keyof PublicProfileForm, "publicProfileEnabled">;

export function PublicProfileCard({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error: loadError, isRefetching, refetch } = usePublicProfile(venueId);
  const [form, setForm] = useState<PublicProfileForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [incomplete, setIncomplete] = useState<string[] | null>(null);

  useEffect(() => {
    if (data) {
      setForm(toForm(data));
      setErrors({});
      setIncomplete(null);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (update: Partial<PublicProfile>) => api.setPublicProfile(venueId, update),
    onSuccess: (profile) => {
      queryClient.setQueryData(["public-profile", venueId], profile);
      setIncomplete(null);
      toast.success(t("publicprofile.saved"));
    },
    onError: (err) => {
      if (isApiError(err, "public_profile_incomplete")) {
        const missing = missingForPublishing(form);
        const latLon = (form.latitude.trim() === "") !== (form.longitude.trim() === "");
        const items = [...missing];
        if (latLon) items.push(t("publicprofile.missing.latLon"));
        if (items.length === 0) items.push(t("publicprofile.missing.venueName"));
        setIncomplete(items);
        return;
      }
      toast.error(
        isApiError(err, "forbidden")
          ? t("publicprofile.forbidden")
          : errorMessage(err, t("publicprofile.saveFailed")),
      );
    },
  });

  function submit() {
    if (!data) return;
    const result = parseForm(form, data);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setIncomplete(null);
    if (Object.keys(result.update).length === 0) {
      toast.success(t("publicprofile.nothingToSave"));
      return;
    }
    save.mutate(result.update);
  }

  function text(key: TextKey) {
    return {
      value: form[key],
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": errors[key] ? `pp-${key}-error` : undefined,
      onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
    };
  }

  function error(key: TextKey) {
    return errors[key] ? (
      <p id={`pp-${key}-error`} role="alert" className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  }

  const url = jsonLdUrl(window.location.origin, venueId);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("publicprofile.url.copied"));
    } catch {
      toast.error(t("publicprofile.url.copyFailed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t("publicprofile.title")}</CardTitle>
        <CardDescription>{t("publicprofile.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Loading><Skeleton className="h-24 w-full" /></Loading>
        ) : isError && !data ? (
          <LoadError compact what={t("publicprofile.loadWhat")} error={loadError} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : (
          <>
            <StatusPanel
              id="pp-enabled"
              label={t("publicprofile.enabled.label")}
              description={t("publicprofile.enabled.help")}
              live={data?.publicProfileEnabled ?? false}
              checked={form.publicProfileEnabled}
              onCheckedChange={(v) => setForm({ ...form, publicProfileEnabled: v })}
              onLabel={t("publicprofile.published")}
            />

            {incomplete && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
              >
                <p>{t("publicprofile.incomplete", { items: incomplete.join(", ") })}</p>
              </div>
            )}

            <Group title={t("publicprofile.address.title")} description={t("publicprofile.address.description")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pp-street">{t("publicprofile.label.street")}</Label>
                  <Input
                    id="pp-street"
                    placeholder="Calle Mayor 1" // i18n-ok
                    {...text("street")}
                  />
                  {error("street")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-locality">{t("publicprofile.label.locality")}</Label>
                  <Input
                    id="pp-locality"
                    placeholder="Madrid" // i18n-ok
                    {...text("locality")}
                  />
                  {error("locality")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-postal">{t("publicprofile.label.postalCode")}</Label>
                  <Input id="pp-postal" placeholder="28013" {...text("postalCode")} />
                  {error("postalCode")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-region">{t("publicprofile.label.region")}</Label>
                  <Input
                    id="pp-region"
                    placeholder="Madrid" // i18n-ok
                    {...text("region")}
                  />
                  {error("region")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-country">{t("publicprofile.label.country")}</Label>
                  <Input id="pp-country" placeholder="ES" maxLength={2} {...text("country")} />
                  {error("country")}
                  <p className="text-sm text-muted-foreground">
                    {t("publicprofile.country.help")}
                  </p>
                </div>
              </div>
            </Group>

            <Group title={t("publicprofile.contact.title")} description={t("publicprofile.contact.description")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pp-phone">{t("publicprofile.label.phone")}</Label>
                  <Input id="pp-phone" type="tel" placeholder="+34 910 000 000" {...text("phone")} />
                  {error("phone")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-cuisine">{t("publicprofile.label.cuisine")}</Label>
                  <Input id="pp-cuisine" placeholder={t("publicprofile.cuisine.placeholder")} {...text("cuisine")} />
                  {error("cuisine")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-website">{t("publicprofile.label.website")}</Label>
                  <Input
                    id="pp-website"
                    type="url"
                    placeholder="https://example.com/" // i18n-ok
                    {...text("websiteUrl")}
                  />
                  {error("websiteUrl")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-booking">{t("publicprofile.label.booking")}</Label>
                  <Input
                    id="pp-booking"
                    type="url"
                    placeholder="https://example.com/reservas" // i18n-ok
                    {...text("bookingUrl")}
                  />
                  {error("bookingUrl")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-price">{t("publicprofile.label.price")}</Label>
                  <select
                    id="pp-price"
                    value={form.priceRange}
                    onChange={(e) => setForm({ ...form, priceRange: e.target.value })}
                    className="h-9 coarse:h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    <option value="">{t("publicprofile.price.none")}</option>
                    {PRICE_RANGES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>

            <Group title={t("publicprofile.location.title")} description={t("publicprofile.location.description")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pp-lat">{t("publicprofile.label.latitude")}</Label>
                  <Input
                    id="pp-lat"
                    type="text"
                    inputMode="decimal"
                    placeholder="40.4168"
                    {...text("latitude")}
                  />
                  {error("latitude")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pp-lon">{t("publicprofile.label.longitude")}</Label>
                  <Input
                    id="pp-lon"
                    type="text"
                    inputMode="decimal"
                    placeholder="-3.7038"
                    {...text("longitude")}
                  />
                  {error("longitude")}
                </div>
              </div>
            </Group>
            <p className="text-sm text-muted-foreground">
              {t("publicprofile.clearHelp")}
            </p>

            <SaveBar>
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("publicprofile.saveButton")}
              </Button>
            </SaveBar>

            <div className="space-y-3 border-t pt-6">
              <h4 className="font-display text-lg">{t("publicprofile.preview.title")}</h4>
              <div className="space-y-2">
                <Label htmlFor="pp-url">{t("publicprofile.url.label")}</Label>
                <div className="flex gap-2">
                  <Input id="pp-url" readOnly value={url} className="font-mono" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("publicprofile.url.copyAria")}
                    onClick={() => void copy()}
                  >
                    <CopyIcon className="size-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("publicprofile.url.help")}
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t("publicprofile.note.name")}</li>
                <li>{t("publicprofile.note.hours")}</li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
