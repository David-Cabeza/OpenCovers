#!/usr/bin/env node
// OpenCovers brand build. Regenerates every file in docs/brand/svg and docs/brand/png.
//   node docs/brand/build.mjs
// Needs Node 22+ and Google Chrome (used headless to rasterise). The wordmark uses
// League Spartan 700 (OFL), loaded from Google Fonts while rasterising.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SVG = join(here, "svg");
const PNG = join(here, "png");
mkdirSync(SVG, { recursive: true });
mkdirSync(PNG, { recursive: true });

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* ---------------------------------------------------------------- tokens */
const C = {
  green: "#0e7c5a",
  ink: "#000000",
  paper: "#f7f7f5",
  white: "#ffffff",
  periwinkle: "#97aaf6",
  lime: "#bbf697",
  amber: "#fed878",
  cyan: "#6ef8fb",
};
const FONT = `'League Spartan', 'Helvetica Neue', Arial, sans-serif`;
const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@700&family=Figtree:wght@400;600&display=swap" rel="stylesheet">`;

/* ---------------------------------------------------------------- the mark
   A round table seen from above: a disc with a hole (the "O" of OpenCovers)
   and eight chairs. viewBox 0 0 120 120, centre (60,60). */
const DISC =
  "M60 25a35 35 0 1 0 0 70a35 35 0 1 0 0-70Z M60 48a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z";

function chairs(fill, n = 8, w = 31, h = 14, r = 7, rad = 47.5) {
  const step = 360 / n;
  return Array.from({ length: n }, (_, i) => {
    const a = i * step;
    return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${r}" fill="${fill}" transform="rotate(${a} 60 60) translate(60 ${60 - rad})"/>`;
  }).join("");
}

/** Full mark. */
function mark(fill) {
  return `<path fill-rule="evenodd" fill="${fill}" d="${DISC}"/>${chairs(fill)}`;
}

/** Simplified mark for 16–48px: four larger chairs, thicker ring. */
function markSmall(fill) {
  const d =
    "M60 28a32 32 0 1 0 0 64a32 32 0 1 0 0-64Z M60 47a13 13 0 1 0 0 26a13 13 0 1 0 0-26Z";
  return `<path fill-rule="evenodd" fill="${fill}" d="${d}"/>${chairs(fill, 4, 32, 18, 7, 48)}`;
}

const svg = (vb, w, h, inner, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"${extra}>${inner}</svg>\n`;

/* ---------------------------------------------------------------- svg files */
const files = {};

files["mark.svg"] = svg("0 0 120 120", 512, 512, `<title>OpenCovers</title>${mark(C.green)}`);
files["mark-black.svg"] = svg("0 0 120 120", 512, 512, `<title>OpenCovers</title>${mark(C.ink)}`);
files["mark-white.svg"] = svg("0 0 120 120", 512, 512, `<title>OpenCovers</title>${mark(C.white)}`);

function appIcon(bg, fg, small = false) {
  const inner = small ? markSmall(fg) : mark(fg);
  return `<rect width="120" height="120" rx="27" fill="${bg}"/><g transform="translate(60 60) scale(${small ? 0.78 : 0.7}) translate(-60 -60)">${inner}</g>`;
}
files["app-icon.svg"] = svg("0 0 120 120", 512, 512, `<title>OpenCovers</title>${appIcon(C.green, C.white)}`);
files["favicon.svg"] = svg("0 0 120 120", 64, 64, `<title>OpenCovers</title>${appIcon(C.green, C.white, true)}`);

/* Wordmark lockups. Text is live (League Spartan 700); see README for outlining. */
const wordmark = (fill, x, y, size, anchor = "start") =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-weight="700" font-size="${size}" letter-spacing="${(-0.04 * size).toFixed(2)}" text-anchor="${anchor}">OpenCovers</text>`;

function horizontal(markFill, textFill) {
  return svg(
    "0 0 640 120",
    1280,
    240,
    `<title>OpenCovers</title>${mark(markFill)}${wordmark(textFill, 142, 87, 84)}`,
  );
}
function stacked(markFill, textFill) {
  return svg(
    "0 0 560 340",
    1120,
    680,
    `<title>OpenCovers</title><g transform="translate(190 0) scale(1.5)">${mark(markFill)}</g>${wordmark(textFill, 280, 292, 92, "middle")}`,
  );
}
files["logo-horizontal.svg"] = horizontal(C.green, C.ink);
files["logo-horizontal-white.svg"] = horizontal(C.white, C.white);
files["logo-horizontal-black.svg"] = horizontal(C.ink, C.ink);
files["logo-stacked.svg"] = stacked(C.green, C.ink);
files["logo-stacked-white.svg"] = stacked(C.white, C.white);

for (const [name, body] of Object.entries(files)) writeFileSync(join(SVG, name), body);

/* ---------------------------------------------------------------- rasterising */
const tmp = join(tmpdir(), "opencovers-brand");
mkdirSync(tmp, { recursive: true });
let n = 0;

function render(out, w, h, body, { bg = "transparent", css = "" } = {}) {
  const html = `<!doctype html><meta charset="utf-8">${FONT_LINK}<style>
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg};font-family:${FONT};}
    ${css}
  </style><body>${body}</body>`;
  const page = join(tmp, `p${n++}.html`);
  writeFileSync(page, html);
  const target = join(PNG, out);
  if (existsSync(target)) rmSync(target);
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=6000",
      `--window-size=${w},${h}`,
      `--screenshot=${target}`,
      `file://${page}`,
    ],
    { stdio: "ignore" },
  );
}

const fit = (file, w, h) => {
  const s = readFileSync(join(SVG, file), "utf8").replace(/ width="\d+" height="\d+"/, ` width="${w}" height="${h}"`);
  return s;
};

// marks (transparent)
for (const s of [256, 512, 1024]) {
  render(`mark-${s}.png`, s, s, fit("mark.svg", s, s));
  render(`mark-white-${s}.png`, s, s, fit("mark-white.svg", s, s));
}
// app icons
for (const s of [180, 192, 512, 1024]) render(`app-icon-${s}.png`, s, s, fit("app-icon.svg", s, s));
// favicons (simplified mark)
for (const s of [16, 32, 48]) render(`favicon-${s}.png`, s, s, fit("favicon.svg", s, s));
// lockups
render("logo-horizontal.png", 2560, 480, fit("logo-horizontal.svg", 2560, 480));
render("logo-horizontal-white.png", 2560, 480, fit("logo-horizontal-white.svg", 2560, 480));
render("logo-stacked.png", 1680, 1020, fit("logo-stacked.svg", 1680, 1020));

/* Social images: the table, cropped, beside the name and the line. */
const big = (size, right, top, fill = C.green) =>
  `<div style="position:absolute;right:${right}px;top:${top}px;width:${size}px;height:${size}px">${svg("0 0 120 120", size, size, mark(fill))}</div>`;

function social(out, w, h, { size, right, top, headline, sub, pad, name, hl }) {
  const body = `
    ${big(size, right, top)}
    <div style="position:absolute;left:${pad}px;top:${pad}px;display:flex;align-items:center;gap:${name * 0.22}px;font-size:${name}px;letter-spacing:-0.04em;color:${C.ink}">
      ${svg("0 0 120 120", name * 1.25, name * 1.25, mark(C.green))}<span>OpenCovers</span>
    </div>
    <div style="position:absolute;left:${pad}px;bottom:${pad}px;color:${C.ink}">
      <div style="font-size:${hl}px;line-height:0.95;letter-spacing:-0.04em;max-width:${w * 0.5}px">${headline}</div>
      <div style="margin-top:${hl * 0.3}px;font-family:'Figtree',system-ui,sans-serif;font-weight:400;font-size:${hl * 0.36}px;line-height:1.3;max-width:${w * 0.5}px">${sub}</div>
    </div>`;
  render(out, w, h, body, { bg: C.paper });
}

const HEAD = "Tu libro de<br>reservas es tuyo.";
const SUB = "Motor de reservas open source con API y servidor MCP.";
social("og-image.png", 1200, 630, { size: 760, right: -150, top: -65, headline: HEAD, sub: SUB, pad: 56, name: 40, hl: 64 });
social("github-social-preview.png", 1280, 640, { size: 780, right: -160, top: -70, headline: HEAD, sub: SUB, pad: 60, name: 42, hl: 68 });
social("x-header.png", 1500, 500, { size: 700, right: -120, top: -100, headline: HEAD, sub: SUB, pad: 48, name: 34, hl: 58 });
social("linkedin-banner.png", 1584, 396, { size: 620, right: -100, top: -112, headline: HEAD, sub: "Motor de reservas open source.", pad: 40, name: 30, hl: 50 });
render("avatar-400.png", 400, 400, fit("app-icon.svg", 400, 400));

/* ICO (16, 32, 48) wrapping the PNGs. */
const sizes = [16, 32, 48];
const pngs = sizes.map((s) => readFileSync(join(PNG, `favicon-${s}.png`)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt8(0, e + 2);
  head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8);
  head.writeUInt32LE(off, e + 12);
  off += pngs[i].length;
});
writeFileSync(join(PNG, "favicon.ico"), Buffer.concat([head, ...pngs]));

/* Contact sheet for review. */
const sheet = `
  <style>.cell svg{max-width:100%;height:auto}</style><div class="cell" style="padding:48px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;font-family:Figtree,sans-serif;font-size:14px;color:#000">
    <div style="background:${C.paper};padding:32px;grid-column:span 2;display:grid;place-items:center">${fit("logo-horizontal.svg", 640, 120)}</div>
    <div style="background:${C.green};padding:32px;grid-column:span 2;display:grid;place-items:center">${fit("logo-horizontal-white.svg", 640, 120)}</div>
    <div style="background:${C.paper};padding:32px;display:grid;place-items:center">${fit("logo-stacked.svg", 300, 182)}</div>
    <div style="background:${C.ink};padding:32px;display:grid;place-items:center">${fit("logo-stacked-white.svg", 300, 182)}</div>
    <div style="background:${C.amber};padding:32px;display:grid;place-items:center">${fit("mark-black.svg", 140, 140)}</div>
    <div style="background:${C.periwinkle};padding:32px;display:grid;place-items:center">${fit("mark.svg", 140, 140)}</div>
    <div style="background:${C.paper};padding:32px;display:flex;gap:24px;align-items:center;justify-content:center;grid-column:span 2">
      ${fit("app-icon.svg", 120, 120)}${fit("favicon.svg", 48, 48)}${fit("favicon.svg", 32, 32)}${fit("favicon.svg", 16, 16)}
    </div>
  </div>`;
render("_contact-sheet.png", 1440, 760, sheet, { bg: "#e9e9e6" });

console.log(`OK — ${Object.keys(files).length} SVG, ${n} PNG, 1 ICO → ${here}`);
