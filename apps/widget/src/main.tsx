import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bookingKeyFrom, guestPageOf, publicApi, selfServiceApi, takeToken, takeWaitlistToken, waitlistApi } from "./api";
import { reportHeight } from "./height";
import { ManagePage } from "./Manage";
import { WaitlistPage } from "./WaitlistPage";
import { followsSystemScheme } from "./theme";
import { localeOf, supportedLocale, translator } from "./messages";
import "./styles.css";

// The API set <html lang> from `?lang=` or the venue's locale when it wrote this page.
// On its own page, or in an iframe whose embed asked for it, the widget follows the visitor's light or dark setting,
// until a venue theme with colors says otherwise.
if (followsSystemScheme(window)) document.documentElement.dataset.scheme = "system";

const locale = localeOf(document.documentElement.lang);
const root = createRoot(document.getElementById("root")!);

const guestPage = guestPageOf(window.location.pathname);

if (guestPage === "waitlist") {
  // The waitlist link is its own page and its own token kind: its token only ever reaches the waitlist routes.
  const token = takeWaitlistToken(window.location, window.history);
  window.addEventListener("hashchange", () => window.location.reload());
  root.render(
    <WaitlistPage
      api={token ? waitlistApi(token) : null}
      fixedLocale={supportedLocale(new URLSearchParams(window.location.search).get("lang"))}
      initialLocale={locale}
      newKey={() => crypto.randomUUID()}
    />,
  );
} else if (guestPage === "booking") {
  // Read once, before anything renders, and cleared from the address bar at once.
  const token = takeToken(window.location, window.history);
  // A link opened in this same tab changes only the fragment, which loads nothing. Load it as a new page.
  window.addEventListener("hashchange", () => window.location.reload());
  root.render(
    <ManagePage
      api={token ? selfServiceApi(token) : null}
      fixedLocale={supportedLocale(new URLSearchParams(window.location.search).get("lang"))}
      initialLocale={locale}
      newKey={() => crypto.randomUUID()}
    />,
  );
} else {
  const bookingKey = bookingKeyFrom(window.location.pathname) ?? "";
  root.render(<App api={publicApi(bookingKey, undefined, locale)} t={translator(locale)} locale={locale} />);
  reportHeight(window);
}
