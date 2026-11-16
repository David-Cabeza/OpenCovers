import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { PublicProfileCard } from "./public-profile-card";
import { SetupView } from "./setup-view";

const PATH = "/v1/venues/v1/public-profile";

const PROFILE = {
  publicProfileEnabled: false,
  street: "Calle Mayor 1",
  locality: "Madrid",
  postalCode: null,
  region: null,
  country: "ES",
  phone: null,
  websiteUrl: null,
  bookingUrl: null,
  cuisine: "Spanish",
  priceRange: "$$",
  latitude: null,
  longitude: null,
};

function setup(put: Parameters<typeof mockApi>[0][string] = (r) => ({
  body: { ...PROFILE, ...(r.body as object) },
})) {
  return mockApi({
    [`GET ${PATH}`]: { body: PROFILE },
    [`PUT ${PATH}`]: put,
  });
}

async function loaded() {
  const street = await screen.findByLabelText("Street");
  await waitFor(() => expect(street).toHaveValue("Calle Mayor 1"));
}

describe("PublicProfileCard", () => {
  afterEach(resetApiMocks);

  it("loads the current profile", async () => {
    setup();
    renderWithApp(<PublicProfileCard venueId="v1" />);

    await loaded();
    expect(screen.getByLabelText("City or town")).toHaveValue("Madrid");
    expect(screen.getByLabelText("Country")).toHaveValue("ES");
    expect(screen.getByLabelText("Cuisine")).toHaveValue("Spanish");
    expect(screen.getByLabelText("Price range")).toHaveValue("$$");
    expect(screen.getByLabelText("Publish the public profile")).not.toBeChecked();
  });

  it("sends only the changed fields, and null to clear", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<PublicProfileCard venueId="v1" />);
    await loaded();

    await user.clear(screen.getByLabelText("Cuisine"));
    await user.type(screen.getByLabelText("Phone"), "+34 910 000 000");
    await user.type(screen.getByLabelText("Website"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Save public profile" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({
      cuisine: null,
      phone: "+34 910 000 000",
      websiteUrl: "https://example.com/",
    });
    expect(await screen.findByText("Public profile saved")).toBeInTheDocument();
  });

  it("sends the enable flag and coordinates together", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<PublicProfileCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByLabelText("Publish the public profile"));
    await user.type(screen.getByLabelText("Latitude"), "40.4168");
    await user.type(screen.getByLabelText("Longitude"), "-3.7038");
    await user.click(screen.getByRole("button", { name: "Save public profile" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({
      publicProfileEnabled: true,
      latitude: 40.4168,
      longitude: -3.7038,
    });
  });

  it("explains what is missing when the API refuses to publish", async () => {
    const user = userEvent.setup();
    setup({ status: 409, body: { code: "public_profile_incomplete" } });
    renderWithApp(<PublicProfileCard venueId="v1" />);
    await loaded();

    await user.clear(screen.getByLabelText("Street"));
    await user.click(screen.getByLabelText("Publish the public profile"));
    await user.click(screen.getByRole("button", { name: "Save public profile" }));

    expect(
      await screen.findByText("The profile cannot be published yet. Missing: street."),
    ).toBeInTheDocument();
  });

  it("rejects invalid input in the form and sends nothing", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<PublicProfileCard venueId="v1" />);
    await loaded();

    const country = screen.getByLabelText("Country");
    await user.clear(country);
    await user.type(country, "es");
    await user.type(screen.getByLabelText("Website"), "http://example.com");
    await user.type(screen.getByLabelText("Booking link"), "https://user:pw@example.com");
    await user.type(screen.getByLabelText("Latitude"), "40");
    await user.click(screen.getByRole("button", { name: "Save public profile" }));

    expect(await screen.findByText(/2-letter upper-case country code/)).toBeInTheDocument();
    expect(screen.getByText(/Use an https address/, { selector: "#pp-websiteUrl-error" })).toBeInTheDocument();
    expect(screen.getByText(/Use an https address/, { selector: "#pp-bookingUrl-error" })).toBeInTheDocument();
    expect(screen.getByText("Give both latitude and longitude, or neither.")).toBeInTheDocument();
    expect(api.calls("PUT", PATH)).toHaveLength(0);
  });

  it("shows the public JSON-LD address and copies it", async () => {
    const user = userEvent.setup();
    setup();
    renderWithApp(<PublicProfileCard venueId="v1" />);
    await loaded();

    const url = `${window.location.origin}/v1/venues/v1/public.jsonld`;
    expect(screen.getByLabelText("Public JSON-LD address")).toHaveValue(url);
    expect(screen.getByText("The venue name becomes public when the profile is published.")).toBeInTheDocument();
    expect(screen.getByText(/published for all 7 days/)).toBeInTheDocument();

    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("is only shown to an admin in the Setup view", async () => {
    setup();
    const { unmount } = renderWithApp(<SetupView venueId="v1" role="write" />);
    await screen.findByText("Booking policy");
    expect(screen.queryByText("Public profile")).not.toBeInTheDocument();
    unmount();

    renderWithApp(<SetupView venueId="v1" role="admin" />);
    expect(await screen.findByText("Public profile")).toBeInTheDocument();
  });
});
