import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bookingKeyFrom, publicApi } from "./api";
import { localeOf, translator } from "./messages";
import "./styles.css";

// The API set <html lang> from `?lang=` or the venue's locale when it wrote this page.
const locale = localeOf(document.documentElement.lang);
const bookingKey = bookingKeyFrom(window.location.pathname) ?? "";

createRoot(document.getElementById("root")!).render(
  <App api={publicApi(bookingKey)} t={translator(locale)} locale={locale} />,
);
