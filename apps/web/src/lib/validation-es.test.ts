import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { parseForm as parseBooking, toForm as bookingForm, type OnlineBooking } from "./online-booking";
import { missingForPublishing, parseForm as parseProfile, toForm as profileForm, type PublicProfile } from "./public-profile";

const STORED: OnlineBooking = {
  enabled: false,
  bookingKey: null,
  allowedOrigins: [],
  services: null,
  weekdays: null,
  minPartySize: 1,
  maxPartySize: 8,
  leadTimeMinutes: 0,
  maxAdvanceDays: null,
  selfServiceCutoffMinutes: 120,
  maxOpenBookingsPerContact: null,
  confirmationMode: "auto",
  askConsent: false,
  locale: "es",
  theme: {},
  privacyNoticeUrl: null,
};

const PROFILE: PublicProfile = {
  publicProfileEnabled: false,
  street: null,
  locality: null,
  postalCode: null,
  region: null,
  country: null,
  phone: null,
  websiteUrl: null,
  bookingUrl: null,
  cuisine: null,
  priceRange: null,
  latitude: null,
  longitude: null,
};

describe("validation messages in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));

  it("online booking", () => {
    const form = { ...bookingForm(STORED), minPartySize: "0", weekdays: [], allowedOrigins: "http://x.com" };
    const result = parseBooking(form, STORED, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.minPartySize).toBe("Un número entero de 1 a 100.");
      expect(result.errors.weekdays).toBe("Elige al menos un día.");
      expect(result.errors.allowedOrigins).toMatch(/^Cada dirección es https:\/\/host/);
    }
  });

  it("public profile", () => {
    const form = { ...profileForm(PROFILE), cuisine: "x".repeat(101), latitude: "40" };
    const result = parseProfile(form, PROFILE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.cuisine).toBe("Cocina: máximo 100 caracteres.");
      expect(result.errors.longitude).toBe("Indica la latitud y la longitud, o ninguna.");
    }
    expect(missingForPublishing(profileForm(PROFILE))).toEqual(["la calle", "la ciudad o localidad", "el país"]);
  });
});
