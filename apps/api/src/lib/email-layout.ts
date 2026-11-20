// The one HTML layout every outgoing email shares. Table-based with inline CSS, so Gmail, Outlook and Apple Mail
// render it alike: 600px wide, no web fonts (Figtree first, then the system sans), no gradients, no shadows.
// Brand per docs/brand/README.md: green #0e7c5a, ink #000, paper #f7f7f5.
//
// Copy comes in as parameters. Nothing in here is wording, so a per-language catalog (ADR-0024) can feed it
// without touching the layout. Every interpolated value is HTML-escaped; hrefs must be http(s) or are dropped.

const GREEN = "#0e7c5a";
const INK = "#000000";
const PAPER = "#f7f7f5";
const MUTED = "#5b5b57";
const RULE = "#e2e2de";
const FONT = "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The mark as a PNG, served by the live site (apps/site/public). Email clients drop SVG, so it has to be a PNG,
 * and it has to be an absolute public URL. It is the 180px app icon: the white mark on a green square.
 */
export const LOGO_URL = "https://opencovers.dev/apple-touch-icon.png";

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  /** Label and value rows, e.g. date, time, party size. */
  | { kind: "details"; rows: readonly { label: string; value: string }[] }
  /** A primary button with the plain URL printed under it, for clients that block or strip buttons. */
  | { kind: "button"; label: string; url: string };

export interface EmailLayout {
  /** `venue`: the sender is a restaurant and its name leads. `opencovers`: OpenCovers-owned mail, fully branded. */
  brand: { kind: "venue"; name: string } | { kind: "opencovers" };
  /** Hidden preview text some inboxes show after the subject. */
  preheader?: string;
  heading: string;
  blocks: readonly EmailBlock[];
  footer: string;
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

/** An escaped href for `url`, or null when it is not an http(s) URL. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? escapeHtml(parsed.href) : null;
  } catch {
    return null;
  }
}

function header(brand: EmailLayout["brand"]): string {
  if (brand.kind === "venue") {
    // The restaurant leads. No OpenCovers mark here: the footer carries the small credit.
    return `<td style="padding:28px 32px 0 32px;font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:${INK};">${escapeHtml(brand.name)}</td>`;
  }
  return `<td style="padding:28px 32px 0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px;vertical-align:middle;"><img src="${LOGO_URL}" width="40" height="40" alt="" style="display:block;border:0;border-radius:8px;"></td>
<td style="vertical-align:middle;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:${INK};">OpenCovers</td>
</tr></table></td>`;
}

function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case "paragraph":
      return `<tr><td style="padding:0 32px 16px 32px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${escapeHtml(block.text)}</td></tr>`;
    case "details":
      return `<tr><td style="padding:0 32px 20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${RULE};">${block.rows
        .map(
          (r) =>
            `<tr><td style="padding:10px 0;border-bottom:1px solid ${RULE};font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(r.label)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${RULE};font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:${INK};">${escapeHtml(r.value)}</td></tr>`,
        )
        .join("")}</table></td></tr>`;
    case "button": {
      const href = safeHref(block.url);
      if (!href) return "";
      return `<tr><td style="padding:4px 32px 12px 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${GREEN}" style="background-color:${GREEN};border-radius:6px;"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(block.label)}</a></td></tr></table></td></tr>
<tr><td style="padding:0 32px 20px 32px;font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};word-break:break-all;"><a href="${href}" style="color:${GREEN};text-decoration:underline;">${escapeHtml(block.url)}</a></td></tr>`;
    }
  }
}

export function renderEmailHtml(layout: EmailLayout): string {
  const preheader = layout.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};font-size:1px;line-height:1px;">${escapeHtml(layout.preheader)}</div>`
    : "";
  return `<!doctype html>
<html lang="${escapeHtml(layout.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(layout.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${RULE};border-radius:8px;">
<tr>${header(layout.brand)}</tr>
<tr><td style="padding:20px 32px 16px 32px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${INK};">${escapeHtml(layout.heading)}</td></tr>
${layout.blocks.map(renderBlock).join("\n")}
<tr><td style="padding:16px 32px 28px 32px;border-top:1px solid ${RULE};font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(layout.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
