/*
 * OpenCovers booking widget embed (ADR-0017 section 1, stage 10).
 *   <script src="https://book.example.com/w/embed.js" data-key="pk_..." async></script>
 * Optional: data-scheme="auto" lets the widget follow the visitor's light or dark setting (it stays light otherwise).
 * Optional: data-lang="en" (one of the supported language codes below) forces the widget's language.
 * Puts the widget's iframe right after this tag and sets its height from the widget's height messages. It reads
 * one thing from the page: the `lang` of the <html> element, reduced to one of the fixed codes below (or dropped).
 * Nothing but a height crosses postMessage.
 */
(function () {
  "use strict";
  var MESSAGE = "opencovers:height";
  var MIN_HEIGHT = 100;
  var MAX_HEIGHT = 6000;

  // Keep in sync with LOCALES in apps/api/src/lib/online-booking.ts and CATALOGS in apps/widget/src/messages.ts
  // (apps/api/test/locales.test.ts compares them).
  var LANGS = ["es", "en", "ca", "fr", "de", "it", "pt"];

  // The base subtag (before the first - or _), lower case, as the matching fixed code or "".
  function pickLang(value) {
    if (typeof value !== "string") return "";
    var base = value.split(/[-_]/)[0].toLowerCase();
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i] === base) return LANGS[i];
    return "";
  }

  function pageLang() {
    var root = document.documentElement;
    return root ? root.lang : "";
  }

  var script = document.currentScript;
  if (!script || script.hasAttribute("data-opencovers-embedded")) return;
  script.setAttribute("data-opencovers-embedded", "");

  var key = script.getAttribute("data-key") || "";
  if (!/^pk_[A-Za-z0-9_-]{16,64}$/.test(key)) {
    console.warn("OpenCovers: data-key must be the venue's booking key (pk_...). No widget added.");
    return;
  }
  // The widget lives where this script came from, never where the page says.
  var origin = new URL(script.src).origin;

  var iframe = document.createElement("iframe");
  var query = [];
  // Only the one value `auto` means anything, and it is sent as a fixed string, never the attribute's own text.
  if (script.getAttribute("data-scheme") === "auto") query.push("scheme=auto");
  // Language: data-lang, else the page's <html lang>, else none (the venue's locale applies). What goes into the
  // URL is the entry of LANGS that matches, never the attribute or page text itself.
  var lang = pickLang(script.getAttribute("data-lang")) || pickLang(pageLang());
  if (lang) query.push("lang=" + lang);
  iframe.src = origin + "/w/" + key + (query.length ? "?" + query.join("&") : "");
  iframe.title = script.getAttribute("data-title") || "Book a table";
  iframe.setAttribute("loading", "lazy");
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.height = "640px";
  iframe.style.border = "0";
  script.parentNode.insertBefore(iframe, script.nextSibling);

  function heightOf(data) {
    if (!data || typeof data !== "object") return null;
    var keys = Object.keys(data).sort();
    if (keys.length !== 2 || keys[0] !== "height" || keys[1] !== "type") return null;
    if (data.type !== MESSAGE || typeof data.height !== "number" || !isFinite(data.height) || data.height < 0) {
      return null;
    }
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height)));
  }

  window.addEventListener("message", function (event) {
    var frame = iframe.contentWindow;
    if (event.origin !== origin || !frame || event.source !== frame) return;
    var height = heightOf(event.data);
    if (height !== null) iframe.style.height = height + "px";
  });
})();
