# Publish your venue to Google (schema.org JSON-LD)

OpenCovers can describe your venue as a schema.org `Restaurant` in JSON-LD, so search engines can read the name, address, phone, cuisine, price range, opening hours and a booking link. See [ADR-0012](adr/0012-public-profile-jsonld.md).

## 1. Fill in the public profile

The public profile is separate from the private venue data. It never uses `noticeAddress`. An admin writes it, and it is off until you turn it on:

```sh
curl -X PUT "$API/v1/venues/$VENUE/public-profile" \
  -H "apikey: $ADMIN_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "street": "Calle Mayor 1", "locality": "Madrid", "postalCode": "28013",
    "region": "Madrid", "country": "ES",
    "phone": "+34 910 000 000",
    "websiteUrl": "https://example.com/",
    "bookingUrl": "https://example.com/reservas",
    "cuisine": "Spanish", "priceRange": "$$",
    "latitude": 40.4168, "longitude": -3.7038,
    "publicProfileEnabled": true
  }'
```

URLs must be `https`. `country` is an upper-case ISO 3166-1 alpha-2 code. Turning it on needs the venue name, `street`, `locality` and `country`. Opening hours come from the venue's services and the weekdays each service opens on (`days` on the service, all seven by default, see [ADR-0014](adr/0014-service-weekdays.md)). Set `days` so a venue that closes one day does not publish false hours. Without a `bookingUrl` the document has no `ReserveAction`.

There is no screen in the staff app for this yet.

## 2. Put the document in your page's HTML

Google reads JSON-LD from the HTML of the page it crawls. It must be in the page itself, not inside an iframe, and the booking widget (which would be an iframe) does not exist yet. Have your site's server fetch the document and print it into the page:

```js
// Node example, any server language works. Cache for a few minutes.
const res = await fetch(`${API}/v1/venues/${VENUE}/public.jsonld`);
const jsonLd = res.ok ? await res.text() : "";
const tag = jsonLd
  ? `<script type="application/ld+json">${jsonLd.replaceAll("<", "\\u003c")}</script>`
  : "";
// insert `tag` in the <head> of your home page
```

The endpoint answers `ETag` and `Cache-Control: public, max-age=300`, so you can revalidate cheaply. Escape `<` as shown so a value can never close the script tag.

## 3. Check it

Paste the page URL into Google's [Rich Results Test](https://search.google.com/test/rich-results) or the [Schema Markup Validator](https://validator.schema.org/). A valid `Restaurant` is read as structured data. Google decides what to show. A `ReserveAction` is valid markup, but a Reserve button in Search needs Google's own reservation programs.

To withdraw the data, set `publicProfileEnabled` to `false`. The endpoint then answers `404`. Caches that hold the old document keep it for up to five minutes.
