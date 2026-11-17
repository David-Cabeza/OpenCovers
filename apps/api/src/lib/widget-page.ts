import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// The widget page of ADR-0017 section 1: an HTML shell the API serves per venue, because `frame-ancestors`
// differs per venue, and the hashed widget build it loads from `/w/assets/`.

type Env = Record<string, string | undefined>;

/**
 * Where the API serves the widget. `any`: no `WIDGET_ADDRESS` outside production, the local development
 * exception that lets the staff app's dev server proxy `/w/*`. `off`: production without `WIDGET_ADDRESS`.
 * `host`: only requests for that host get the widget.
 */
export type WidgetServing = { kind: "any" } | { kind: "off" } | { kind: "host"; host: string };

function hostOf(address: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`);
  } catch {
    return null;
  }
}

export function widgetServingFromEnv(env: Env = process.env): WidgetServing {
  const address = env.WIDGET_ADDRESS?.trim();
  if (!address) return env.NODE_ENV === "production" ? { kind: "off" } : { kind: "any" };
  const url = hostOf(address);
  if (!url || !url.hostname || url.pathname !== "/" || url.search || url.username) {
    throw new Error(`WIDGET_ADDRESS must be a host such as book.example.com. Got "${address}".`);
  }
  // Cookies ignore the port, so a widget on the staff app's host name would share the staff session cookie.
  const staff = [env.BETTER_AUTH_URL, ...(env.TRUSTED_ORIGINS?.split(",") ?? [])]
    .map((origin) => origin && hostOf(origin.trim())?.hostname)
    .filter(Boolean);
  if (staff.includes(url.hostname)) {
    throw new Error(
      `WIDGET_ADDRESS (${url.hostname}) must be a host name of its own, not the staff app's (ADR-0017, Q1).`,
    );
  }
  return { kind: "host", host: url.host };
}

export function servesWidgetOn(serving: WidgetServing, requestUrl: string): boolean {
  if (serving.kind === "any") return true;
  if (serving.kind === "off") return false;
  return new URL(requestUrl).host.toLowerCase() === serving.host;
}

export function describeWidgetServing(serving: WidgetServing): string {
  if (serving.kind === "host") return `widget page: served on ${serving.host} only`;
  if (serving.kind === "off") return "widget page: off (set WIDGET_ADDRESS to serve it)";
  return "widget page: served on any host (development; set WIDGET_ADDRESS in production)";
}

const POLICY =
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; " +
  "style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function widgetCsp(allowedOrigins: readonly string[]): string {
  const ancestors = allowedOrigins.length === 0 ? "'none'" : ["'self'", ...allowedOrigins].join(" ");
  return `${POLICY}; frame-ancestors ${ancestors}`;
}

export function widgetHeaders(allowedOrigins: readonly string[]): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": widgetCsp(allowedOrigins),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

export interface WidgetAssets {
  scripts: string[];
  styles: string[];
}

export const defaultWidgetDist = () => path.resolve(import.meta.dirname, "../../../widget/dist");

const MANIFEST_ENTRY = "src/main.tsx";
let cached: { file: string; mtimeMs: number; assets: WidgetAssets } | null = null;

/** The entry script and styles from the Vite manifest, or null when the widget is not built. */
export function widgetAssets(dist: string): WidgetAssets | null {
  const file = path.join(dist, ".vite", "manifest.json");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.assets;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, { file: string; css?: string[] }>;
  const entry = manifest[MANIFEST_ENTRY];
  if (!entry) return null;
  const assets = { scripts: [entry.file], styles: entry.css ?? [] };
  cached = { file, mtimeMs, assets };
  return assets;
}

const ASSET_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(js|css|woff2|svg|png)$/;
const ASSET_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  svg: "image/svg+xml",
  png: "image/png",
};

/** One built asset by its file name, never a path, so nothing outside `dist/assets` can be read. */
export function readWidgetAsset(dist: string, name: string): { body: Buffer; type: string } | null {
  const match = ASSET_NAME.exec(name);
  if (!match) return null;
  try {
    return { body: readFileSync(path.join(dist, "assets", name)), type: ASSET_TYPES[match[2]] };
  } catch {
    return null;
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function widgetHtml(opts: { lang: string; title: string; assets: WidgetAssets }): string {
  const styles = opts.assets.styles.map((f) => `<link rel="stylesheet" href="/w/${escapeHtml(f)}">`).join("");
  const scripts = opts.assets.scripts.map((f) => `<script type="module" src="/w/${escapeHtml(f)}"></script>`).join("");
  return (
    `<!doctype html><html lang="${escapeHtml(opts.lang)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(opts.title)}</title>${styles}${scripts}</head>` +
    `<body><div id="root"></div></body></html>`
  );
}

// One page in both widget locales, so an unknown, rotated and disabled key read the same whatever `lang` says.
export const NOT_FOUND_HTML =
  `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
  `<title>Reservas no disponibles</title></head><body>` +
  `<p>Las reservas en línea no están disponibles en esta dirección.</p>` +
  `<p lang="en">Online booking is not available at this address.</p></body></html>`;
