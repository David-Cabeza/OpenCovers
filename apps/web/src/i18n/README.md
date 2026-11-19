# Languages of the staff app

The staff app speaks Spanish (`es`) and English (`en`). The person chooses in the language selector in the top bar (and on
the sign-in screen), the choice is kept in this browser, and the first time the app uses the browser's language if it is
one of ours and Spanish otherwise. The booking widget has its own catalogs (`apps/widget/src/messages.ts`); this is only
the staff app.

## How a text gets into the app

Every text people read lives in a catalog, never in a component.

```ts
// i18n/catalog/agenda.ts  (one file per area; every key starts with the area's name)
import { defineMessages } from "../define";

export default defineMessages({
  en: {
    "agenda.title": "Agenda",
    "agenda.cancelled": "Reservation cancelled",
    "agenda.bookings": { one: "{count} booking", other: "{count} bookings" },
  },
  es: {
    "agenda.title": "Agenda",
    "agenda.cancelled": "Reserva cancelada",
    "agenda.bookings": { one: "{count} reserva", other: "{count} reservas" },
  },
});
```

`en` is the source of the keys. `es` must have exactly the same keys, or the type check fails. `catalog.test.ts` also
checks that no key is in two files, that the placeholders match, and that most of the Spanish is not the English again.

In a component:

```tsx
const t = useT();
<h1>{t("agenda.title")}</h1>
toast.success(t("agenda.cancelled"));
{t("agenda.bookings", { count: rows.length })}   // a plural message needs a numeric `count`
```

Outside React (a validation, a helper in `lib/`) import `t` from `@/i18n`; it reads the language in use when it runs.
Text that must exist before any language is known does not exist: there is always a language.

When the person changes the language, `LocaleBoundary` draws the whole app again, so a text read by a plain function is
also in the new language. That is why `t` is enough almost everywhere; use `useT` in components anyway, since a component
shown on its own (a test, a story) then follows the language too.

## Rules

- **Whole sentences.** Never build a sentence out of pieces (`"Party of " + n`, or two translated halves around a
  link). Word order differs. Make one message with placeholders: `"Party of {count}"`. For a sentence with a link or a
  bold word inside, split it into the parts that stay whole and keep the markup in the component.
- **Plurals** are messages with `{ one, other }` and a `count` parameter. Spanish and English both have two forms.
- **No constants with text at module level.** A `const LABELS = { a: "Seat" }` is read once, when the module loads, so
  it cannot follow the language. Keep a key (`labelKey: "agenda.action.seat"`) and call `t` where it is shown, or make
  it a function. A getter works too (see `lib/weekdays.ts`).
- **Data is not translated.** Names of venues, tables, services, guests, notes, and what the API sends are shown as
  they are. What the app says about them is translated: "Booked", "No tables yet".
- **Codes are not shown.** An API error code or a status (`no_show`) is turned into a message through the catalog.
  Error messages for the API's documented codes are `errors.api.<code>` and are read through `errorMessage` in
  `lib/error-message.ts`.
- **Dates and times** go through `lib/date.ts` (`longDate`, `dateTime`, `elapsed`) or `Intl` with `currentLocale()`, never
  with the browser's default. Times of day that come from the API as `20:30` are shown as they are.
- **Shared words** (Cancel, Save, Try again, the reservation statuses, the roles, the consent values) are in
  `catalog/common.ts`. Use them. Anything else goes in the area's own file, even if another area has a similar one.
- **Numbers in text** (`2 seats`) are a plural message, not `"{n} seats"`.
- **Accessible names count.** `aria-label`, `title`, `alt`, `placeholder` and `sr-only` text are translated too.
- A text that should stay the same in every language (the product name `OpenCovers`, a technical term such as `Webhook`,
  an email example) stays in the component, and the line ends with `// i18n-ok`.

## Spanish style

Natural, plain Spanish from Spain, addressing the person as **tú** (as the booking widget does). Sentence case, like the
English. Short. Do not translate word for word. Use these terms everywhere:

| English | Spanish |
| --- | --- |
| venue | local |
| reservation, booking | reserva |
| guest (a person with a booking) | cliente, or *comensal* when counting people at a table (`2 comensales`) |
| party of 4 | grupo de 4 |
| table | mesa |
| seat (a place at a table) | plaza |
| walk-in (a guest with no booking) | cliente sin reserva |
| waitlist | lista de espera |
| pre-shift | previo al servicio |
| floor plan | plano de sala |
| availability | disponibilidad |
| pacing | ritmo |
| service (lunch, dinner) | servicio |
| settings | ajustes |
| team, member | equipo, miembro |
| invitation | invitación |
| API key | clave de API |
| online booking | reserva en línea |
| booking page, widget | página de reservas, widget |
| no-show | no se presentó |
| sign in / sign up / sign out | iniciar sesión / registrarse / cerrar sesión |
| email, contact (email or phone) | email, contacto |
| note | nota |
| log, audit log | registro, registro de auditoría |
| blocklist | lista de bloqueos |
| zone | zona |

## Checking your work

- `pnpm --filter @opencovers/web typecheck` fails if a Spanish text is missing.
- The tests run in English (`test-setup.ts` sets it), so a screen's English texts are what its tests look for. To test
  Spanish, set the language before rendering: `useUiStore.setState({ locale: "es" })`.
- `node scripts/i18n-audit.mjs src/components/agenda` lists text still written in the component. A line that is right
  as it is ends with `// i18n-ok`.
