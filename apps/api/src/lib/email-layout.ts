// The one layout every outgoing email shares, as HTML and as plain text from the same blocks, so the two parts say
// the same thing. Hand-built tables with inline CSS: no framework, no template engine, no web fonts (Figtree first,
// then the system sans), no gradients, no shadows. Brand per docs/brand/README.md: green #0e7c5a, ink, paper #f7f7f5.
//
// What it does for the clients that matter:
//  - Gmail and Apple Mail: a `<style>` block with a dark palette under `prefers-color-scheme`, `color-scheme` metas, and
//    a phone breakpoint. Every color is also inline, so a client that drops the block still shows the light design.
//  - Outlook for Windows (Word engine): buttons are VML `roundrect`s inside conditional comments, with the pixel
//    density setting its images need. Outlook.com dark mode is covered by the `[data-ogsc]` and `[data-ogsb]` rules.
//  - Forced inversion (Gmail Android, some Outlook builds): no pure black or white text, the one image is a green
//    square with a white mark, a venue logo sits on its own white tile, and the button carries its own colors.
//  - Blocked images: every image has fixed width and height in a cell of the same size, so nothing shifts.
//
// Copy comes in as parameters. Nothing in here is wording, so a per-language catalog (ADR-0024) feeds it without
// touching the layout. Every interpolated value is HTML-escaped; hrefs must be https (http for a local origin) or a
// `tel:` link, or they are dropped.

import { contrast } from "./contrast";

const FONT = "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** The light palette. Every text and background pair below is checked for 4.5:1 by `email-quality.test.ts`. */
export const LIGHT = {
  page: "#f7f7f5",
  card: "#ffffff",
  panel: "#f7f7f5",
  ink: "#141413",
  muted: "#5b5b57",
  rule: "#e2e2de",
  link: "#0e7c5a",
  accent: "#0e7c5a",
  onAccent: "#ffffff",
} as const;

/** The dark palette, for clients that honor `prefers-color-scheme: dark`. */
export const DARK = {
  page: "#0f0f0e",
  card: "#1a1a18",
  panel: "#242421",
  ink: "#f3f1ec",
  muted: "#b8b5ac",
  rule: "#3a3935",
  link: "#6fd6ae",
  accent: "#3ecb9b",
  onAccent: "#0a1f17",
} as const;

/** The colors a venue's theme gives the buttons. A pair that fails 4.5:1 is dropped for the brand's. */
export interface EmailAccent {
  accent: string;
  onAccent: string;
  darkAccent: string;
  darkOnAccent: string;
}

export const DEFAULT_ACCENT: EmailAccent = {
  accent: LIGHT.accent,
  onAccent: LIGHT.onAccent,
  darkAccent: DARK.accent,
  darkOnAccent: DARK.onAccent,
};

/**
 * The mark as a PNG, served by the live site (apps/site/public). Email clients drop SVG, so it has to be a PNG,
 * and it has to be an absolute public URL. It is the 180px app icon: the white mark on a green square.
 */
export const LOGO_URL = "https://opencovers.dev/apple-touch-icon.png";
export const SITE_URL = "https://opencovers.dev";

export const BODY_PX = 16;

export interface EmailRow {
  label: string;
  value: string;
  /** Makes the value a link: https, http or `tel:`. */
  href?: string;
}

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  /** Small muted text. */
  | { kind: "note"; text: string }
  /** The booking card: label and value rows, each value large. */
  | { kind: "summary"; rows: readonly EmailRow[] }
  /** A button. `showUrl` prints the plain URL under it, for clients that strip buttons. */
  | { kind: "button"; label: string; url: string; style?: "primary" | "secondary"; showUrl?: boolean };

export interface EmailLayout {
  /** `venue`: the sender is a restaurant and its name leads. `opencovers`: OpenCovers-owned mail, fully branded. */
  brand: { kind: "venue"; name: string; logoUrl?: string } | { kind: "opencovers" };
  accent?: EmailAccent;
  /** Hidden preview text some inboxes show after the subject. */
  preheader: string;
  heading: string;
  blocks: readonly EmailBlock[];
  /** The credit line, e.g. "Reservas con OpenCovers". */
  footer: string;
  /** Why the guest got this mail. Optional. */
  footerNote?: string;
  /** Page language, for `<html lang>`. */
  lang: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `url` as the URL parser writes it, or null when it is not an http(s) URL or a `tel:` link. */
function normalizedUrl(url: string): string | null {
  if (/^tel:\+?[0-9]{5,20}$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** An escaped href for `url`, or null when it is not an http(s) URL or a `tel:` link. */
function safeHref(url: string): string | null {
  const href = normalizedUrl(url);
  return href === null ? null : escapeHtml(href);
}

/** The brand colors of a venue's theme, checked: a pair under 4.5:1 falls back to the brand's pair. */
export function accentFor(colors?: { primary?: string; onPrimary?: string }, dark?: { primary?: string; onPrimary?: string }): EmailAccent {
  const pair = (p: { primary?: string; onPrimary?: string } | undefined, fallbackOn: string) => {
    if (!p?.primary || !/^#[0-9a-fA-F]{6}$/.test(p.primary)) return null;
    const on = p.onPrimary && /^#[0-9a-fA-F]{6}$/.test(p.onPrimary) ? p.onPrimary : fallbackOn;
    return contrast(on, p.primary) >= 4.5 ? { accent: p.primary.toLowerCase(), on: on.toLowerCase() } : null;
  };
  const light = pair(colors, "#ffffff");
  const night = pair(dark, DARK.onAccent);
  return {
    accent: light?.accent ?? DEFAULT_ACCENT.accent,
    onAccent: light?.on ?? DEFAULT_ACCENT.onAccent,
    // A venue without a dark palette keeps its own button color: the button is a solid box and reads on dark too.
    darkAccent: night?.accent ?? light?.accent ?? DEFAULT_ACCENT.darkAccent,
    darkOnAccent: night?.on ?? light?.on ?? DEFAULT_ACCENT.darkOnAccent,
  };
}

const STYLE = (a: EmailAccent) => `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse}
img{-ms-interpolation-mode:bicubic}
a{text-decoration:underline}
@media only screen and (max-width:620px){
.wrap{padding:12px 8px!important}
.pad{padding-left:20px!important;padding-right:20px!important}
.h1{font-size:24px!important;line-height:30px!important}
.btn-tbl{width:100%!important}
.btn-cell{display:block!important;width:100%!important}
.btn-a{display:block!important;text-align:center!important}
}
@media (prefers-color-scheme:dark){
.c-page{background-color:${DARK.page}!important}
.c-card{background-color:${DARK.card}!important;border-color:${DARK.rule}!important}
.c-panel{background-color:${DARK.panel}!important;border-color:${DARK.rule}!important}
.c-ink{color:${DARK.ink}!important}
.c-muted{color:${DARK.muted}!important}
.c-rule{border-color:${DARK.rule}!important}
.c-link{color:${DARK.link}!important}
.c-bar{background-color:${a.darkAccent}!important}
.c-btn{background-color:${a.darkAccent}!important;border-color:${a.darkAccent}!important}
.c-btn-a{color:${a.darkOnAccent}!important}
.c-btn2{border-color:${DARK.link}!important}
.c-btn2-a{color:${DARK.link}!important}
}
[data-ogsc] .c-ink{color:${DARK.ink}!important}
[data-ogsc] .c-muted{color:${DARK.muted}!important}
[data-ogsc] .c-link{color:${DARK.link}!important}
[data-ogsb] .c-page{background-color:${DARK.page}!important}
[data-ogsb] .c-card{background-color:${DARK.card}!important}
[data-ogsb] .c-panel{background-color:${DARK.panel}!important}
</style>`;

function header(layout: EmailLayout): string {
  const { brand } = layout;
  if (brand.kind === "venue") {
    // The restaurant leads. No OpenCovers mark here: the footer carries the small credit. The logo is decorative next
    // to the name, so its alt is empty and a blocked image leaves no stray text.
    const logoHref = brand.logoUrl ? safeHref(brand.logoUrl) : null;
    const logo = logoHref
      ? `<td width="48" style="width:48px;padding-right:8px;vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" bgcolor="#ffffff" style="width:40px;height:40px;background-color:#ffffff;border-radius:8px;"><img src="${logoHref}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:8px;object-fit:contain;"></td></tr></table></td>`
      : "";
    return `<tr><td class="pad" style="padding:28px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}<td class="c-ink" style="vertical-align:middle;font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${LIGHT.ink};">${escapeHtml(brand.name)}</td></tr></table></td></tr>`;
  }
  return `<tr><td class="pad" style="padding:28px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="48" style="width:48px;padding-right:8px;vertical-align:middle;"><img src="${LOGO_URL}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:8px;"></td>
<td class="c-ink" style="vertical-align:middle;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:${LIGHT.ink};">OpenCovers</td>
</tr></table></td></tr>`;
}

function renderRow(row: EmailRow, first: boolean): string {
  const href = row.href ? safeHref(row.href) : null;
  const value = href
    ? `<a class="c-link" href="${href}" style="color:${LIGHT.link};text-decoration:underline;">${escapeHtml(row.value)}</a>`
    : escapeHtml(row.value);
  return `<tr><td class="c-rule" style="padding:14px 20px;${first ? "" : `border-top:1px solid ${LIGHT.rule};`}"><div class="c-muted" style="font-family:${FONT};font-size:14px;line-height:20px;color:${LIGHT.muted};">${escapeHtml(row.label)}</div><div class="c-ink" style="font-family:${FONT};font-size:18px;line-height:26px;font-weight:700;color:${LIGHT.ink};">${value}</div></td></tr>`;
}

function renderButton(block: Extract<EmailBlock, { kind: "button" }>, a: EmailAccent): string {
  const href = safeHref(block.url);
  if (!href) return "";
  const primary = block.style !== "secondary";
  const width = Math.min(520, Math.max(220, block.label.length * 10 + 64));
  const label = escapeHtml(block.label);
  const vml = primary
    ? `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="17%" stroke="f" fillcolor="${a.accent}"><w:anchorlock/><center style="color:${a.onAccent};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect>`
    : `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="17%" strokecolor="${LIGHT.link}" strokeweight="2px" fillcolor="${LIGHT.card}"><w:anchorlock/><center style="color:${LIGHT.link};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect>`;
  const cellStyle = primary
    ? `background-color:${a.accent};border:2px solid ${a.accent};border-radius:8px;`
    : `background-color:transparent;border:2px solid ${LIGHT.link};border-radius:8px;`;
  const linkStyle = primary
    ? `color:${a.onAccent};`
    : `color:${LIGHT.link};`;
  const cellClass = primary ? "btn-cell c-btn" : "btn-cell c-btn2";
  const linkClass = primary ? "btn-a c-btn-a" : "btn-a c-btn2-a";
  const button = `<tr><td class="pad" style="padding:4px 32px 12px 32px;"><table role="presentation" class="btn-tbl" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td class="${cellClass}" align="center" style="${cellStyle}">
<!--[if mso]>${vml}<![endif]-->
<!--[if !mso]><!--><a class="${linkClass}" href="${href}" style="display:inline-block;min-height:48px;box-sizing:border-box;padding:13px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;text-decoration:none;${linkStyle}">${label}</a><!--<![endif]-->
</td></tr></table></td></tr>`;
  if (!block.showUrl) return button;
  return `${button}
<tr><td class="pad c-muted" style="padding:0 32px 20px 32px;font-family:${FONT};font-size:14px;line-height:20px;color:${LIGHT.muted};word-break:break-all;"><a class="c-link" href="${href}" style="color:${LIGHT.link};text-decoration:underline;">${escapeHtml(block.url)}</a></td></tr>`;
}

function renderBlock(block: EmailBlock, a: EmailAccent): string {
  switch (block.kind) {
    case "paragraph":
      return `<tr><td class="pad c-ink" style="padding:0 32px 16px 32px;font-family:${FONT};font-size:${BODY_PX}px;line-height:24px;color:${LIGHT.ink};">${escapeHtml(block.text)}</td></tr>`;
    case "note":
      return `<tr><td class="pad c-muted" style="padding:0 32px 16px 32px;font-family:${FONT};font-size:14px;line-height:21px;color:${LIGHT.muted};">${escapeHtml(block.text)}</td></tr>`;
    case "summary":
      return `<tr><td class="pad" style="padding:4px 32px 20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="c-panel" bgcolor="${LIGHT.panel}" style="border-collapse:separate;background-color:${LIGHT.panel};border:1px solid ${LIGHT.rule};border-radius:10px;">${block.rows
        .map((r, i) => renderRow(r, i === 0))
        .join("")}</table></td></tr>`;
    case "button":
      return renderButton(block, a);
  }
}

/** Invisible filler after the preheader, so the inbox does not pull body text into the preview. */
const PREHEADER_FILL = "&#8199;&zwnj;".repeat(60);

export function renderEmailHtml(layout: EmailLayout): string {
  const a = layout.accent ?? DEFAULT_ACCENT;
  const preheader = `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(layout.preheader)}${PREHEADER_FILL}</div>`;
  const note = layout.footerNote
    ? `<div>${escapeHtml(layout.footerNote)}</div>`
    : "";
  return `<!doctype html>
<html lang="${escapeHtml(layout.lang)}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(layout.heading)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
${STYLE(a)}
</head>
<body class="c-page" style="margin:0;padding:0;background-color:${LIGHT.page};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="c-page" bgcolor="${LIGHT.page}" style="background-color:${LIGHT.page};">
<tr><td class="wrap" align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="c-card" bgcolor="${LIGHT.card}" style="width:100%;max-width:600px;border-collapse:separate;background-color:${LIGHT.card};border:1px solid ${LIGHT.rule};border-radius:12px;">
<tr><td class="c-bar" height="4" bgcolor="${a.accent}" style="height:4px;line-height:0;font-size:0;background-color:${a.accent};border-radius:12px 12px 0 0;">&nbsp;</td></tr>
${header(layout)}
<tr><td class="pad c-ink" style="padding:20px 32px 12px 32px;"><h1 class="h1 c-ink" style="margin:0;font-family:${FONT};font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.01em;color:${LIGHT.ink};">${escapeHtml(layout.heading)}</h1></td></tr>
${layout.blocks.map((b) => renderBlock(b, a)).join("\n")}
<tr><td class="pad c-rule c-muted" style="padding:16px 32px 28px 32px;border-top:1px solid ${LIGHT.rule};font-family:${FONT};font-size:13px;line-height:19px;color:${LIGHT.muted};">${note}<div><a class="c-muted" href="${SITE_URL}" style="color:${LIGHT.muted};text-decoration:underline;">${escapeHtml(layout.footer)}</a></div></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The same content as plain text: the blocks in order, rows as `Label: value`, buttons as `Label: URL`. */
export function renderEmailText(layout: EmailLayout): string {
  const brand = layout.brand.kind === "venue" ? layout.brand.name : "OpenCovers";
  const parts: string[] = [`${brand}\n\n${layout.heading}`];
  for (const block of layout.blocks) {
    switch (block.kind) {
      case "paragraph":
      case "note":
        parts.push(block.text);
        break;
      case "summary":
        parts.push(block.rows.map((r) => `${r.label}: ${r.value}`).join("\n"));
        break;
      case "button": {
        const href = normalizedUrl(block.url);
        if (href) parts.push(`${block.label}: ${href}`);
        break;
      }
    }
  }
  const tail = [layout.footerNote, layout.footer].filter(Boolean).join("\n");
  return `${parts.join("\n\n")}\n\n--\n${tail}\n`;
}
