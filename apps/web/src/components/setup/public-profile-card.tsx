import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  const queryClient = useQueryClient();
  const { data, isPending } = usePublicProfile(venueId);
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
      toast.success("Public profile saved");
    },
    onError: (err) => {
      if (isApiError(err, "public_profile_incomplete")) {
        const missing = missingForPublishing(form);
        const latLon = (form.latitude.trim() === "") !== (form.longitude.trim() === "");
        const items = [...missing];
        if (latLon) items.push("both latitude and longitude, or neither");
        if (items.length === 0) items.push("the venue name");
        setIncomplete(items);
        return;
      }
      toast.error(
        isApiError(err, "forbidden")
          ? "Only an admin can change the public profile."
          : errorMessage(err, "Could not save the public profile."),
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
      toast.success("Nothing to save");
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
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy. Select the address and copy it by hand.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public profile</CardTitle>
        <CardDescription>
          The details search engines can read about your venue, as schema.org JSON-LD. Nothing is
          published until you turn it on. The private notice address is never used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="pp-enabled">Publish the public profile</Label>
                <p className="text-sm text-muted-foreground">
                  Needs street, city or town and country. The venue name becomes public too.
                </p>
              </div>
              <Switch
                id="pp-enabled"
                checked={form.publicProfileEnabled}
                onCheckedChange={(v) => setForm({ ...form, publicProfileEnabled: v })}
              />
            </div>

            {incomplete && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
              >
                <p>The profile cannot be published yet. Missing: {incomplete.join(", ")}.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="pp-street">Street</Label>
                <Input id="pp-street" placeholder="Calle Mayor 1" {...text("street")} />
                {error("street")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-locality">City or town</Label>
                <Input id="pp-locality" placeholder="Madrid" {...text("locality")} />
                {error("locality")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-postal">Postal code</Label>
                <Input id="pp-postal" placeholder="28013" {...text("postalCode")} />
                {error("postalCode")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-region">Region</Label>
                <Input id="pp-region" placeholder="Madrid" {...text("region")} />
                {error("region")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-country">Country</Label>
                <Input id="pp-country" placeholder="ES" maxLength={2} {...text("country")} />
                {error("country")}
                <p className="text-sm text-muted-foreground">
                  2-letter ISO code in capitals, for example ES.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-phone">Phone</Label>
                <Input id="pp-phone" type="tel" placeholder="+34 910 000 000" {...text("phone")} />
                {error("phone")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-cuisine">Cuisine</Label>
                <Input id="pp-cuisine" placeholder="Spanish" {...text("cuisine")} />
                {error("cuisine")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-website">Website</Label>
                <Input
                  id="pp-website"
                  type="url"
                  placeholder="https://example.com/"
                  {...text("websiteUrl")}
                />
                {error("websiteUrl")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-booking">Booking link</Label>
                <Input
                  id="pp-booking"
                  type="url"
                  placeholder="https://example.com/reservas"
                  {...text("bookingUrl")}
                />
                {error("bookingUrl")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-price">Price range</Label>
                <select
                  id="pp-price"
                  value={form.priceRange}
                  onChange={(e) => setForm({ ...form, priceRange: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="">Not shown</option>
                  {PRICE_RANGES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div />
              <div className="space-y-2">
                <Label htmlFor="pp-lat">Latitude</Label>
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
                <Label htmlFor="pp-lon">Longitude</Label>
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
            <p className="text-sm text-muted-foreground">
              Empty a field and save to clear it. Coordinates are optional, but give both or
              neither.
            </p>

            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save public profile"}
            </Button>

            <div className="space-y-3 border-t pt-6">
              <h3 className="text-sm font-medium">Preview</h3>
              <div className="space-y-2">
                <Label htmlFor="pp-url">Public JSON-LD address</Label>
                <div className="flex gap-2">
                  <Input id="pp-url" readOnly value={url} className="font-mono" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy address"
                    onClick={() => void copy()}
                  >
                    <CopyIcon className="size-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Add this document to the HTML of your own site. It answers only while the profile
                  is published.
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>The venue name becomes public when the profile is published.</li>
                <li>
                  Opening hours come from your services and the days they run, so keep the days
                  of each service up to date.
                </li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
