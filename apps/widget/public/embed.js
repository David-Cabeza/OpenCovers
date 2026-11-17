/*
 * OpenCovers booking widget embed (ADR-0017 section 1, stage 10).
 *   <script src="https://book.example.com/w/embed.js" data-key="pk_..." async></script>
 * Puts the widget's iframe right after this tag and sets its height from the widget's height messages. It reads
 * nothing else from the page, and nothing but a height crosses postMessage.
 */
(function () {
  "use strict";
  var MESSAGE = "opencovers:height";
  var MIN_HEIGHT = 100;
  var MAX_HEIGHT = 6000;

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
  iframe.src = origin + "/w/" + key;
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
