import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bookingKeyFrom, publicApi, selfServiceApi, takeToken } from "./api";
import { reportHeight } from "./height";
import { ManagePage } from "./Manage";
import { localeOf, supportedLocale, translator } from "./messages";
import "./styles.css";

// The API set <html lang> from `?lang=` or the venue's locale when it wrote this page.
const locale = localeOf(document.documentElement.lang);
const root = createRoot(document.getElementById("root")!);

if (window.location.pathname === "/r") {
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
  root.render(<App api={publicApi(bookingKey)} t={translator(locale)} locale={locale} />);
  reportHeight(window);
}
