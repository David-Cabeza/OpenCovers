// Theme tokens of ADR-0017 section 5. The API validates a theme on write; the widget checks every value again
// before use, so a stored value that fails the rules only falls back to the built-in default in styles.css.

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_URL = 2048;

const COLOR_VARS = {
  primary: "--oc-primary",
  onPrimary: "--oc-on-primary",
  background: "--oc-background",
  surface: "--oc-surface",
  text: "--oc-text",
  muted: "--oc-muted",
  border: "--oc-border",
} as const;

export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT", "Arial Rounded MT Bold", Calibri, sans-serif',
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

function colorVars(colors: unknown): [string, string][] {
  const vars: [string, string][] = [];
  if (isObject(colors)) {
    for (const [key, value] of Object.entries(colors)) {
      if (own(COLOR_VARS, key) && typeof value === "string" && HEX.test(value)) vars.push([COLOR_VARS[key], value.toLowerCase()]);
    }
  }
  return vars;
}

/**
 * The CSS custom properties a theme sets, each from a value that passed the rules. Absent or invalid keys are left
 * out. The colors come from `colors`, or from `darkColors` for the dark palette.
 */
export function themeVars(theme: unknown, palette: "light" | "dark" = "light"): [name: string, value: string][] {
  if (!isObject(theme)) return [];
  const vars = colorVars(palette === "dark" ? theme.darkColors : theme.colors);
  const { radius, font } = theme;
  if (typeof radius === "number" && Number.isInteger(radius) && radius >= 0 && radius <= 24) vars.push(["--oc-radius", `${radius}px`]);
  if (typeof font === "string" && own(FONT_STACKS, font)) vars.push(["--oc-font", FONT_STACKS[font]]);
  return vars;
}

/** Sets the theme on an element's style, one property at a time, so no venue string is ever parsed as CSS. */
export function applyTheme(theme: unknown, style: Pick<CSSStyleDeclaration, "setProperty">): void {
  for (const [name, value] of themeVars(theme)) style.setProperty(name, value);
}

/** True when the theme sets at least one color. The venue then owns its palette, and the widget never swaps it for the dark one. */
export function setsColors(theme: unknown): boolean {
  const colorVars: readonly string[] = Object.values(COLOR_VARS);
  return themeVars(theme).some(([name]) => colorVars.includes(name));
}

/** True when the theme has a dark palette, even an empty one. The widget then offers its dark look whatever `colors` say. */
export function setsDarkColors(theme: unknown): boolean {
  return isObject(theme) && isObject(theme.darkColors);
}

/** True inside an iframe. A page on the venue's own site picks its look, and the visitor's system setting says nothing about it. */
export function isFramed(win: Pick<Window, "self" | "top">): boolean {
  return win.self !== win.top;
}

/**
 * True when the page should follow the visitor's light or dark setting: on its own page always, and in an iframe only
 * when the embedding site asked for it with `?scheme=auto` (the `data-scheme="auto"` of `embed.js`).
 */
export function followsSystemScheme(win: Pick<Window, "self" | "top" | "location">): boolean {
  return !isFramed(win) || new URLSearchParams(win.location.search).get("scheme") === "auto";
}

type ThemeStyle = Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
type ThemeDocument = { documentElement: Pick<HTMLElement, "dataset"> & { style: ThemeStyle } };

/**
 * Sets the theme on the page. The widget follows the visitor's light or dark setting on its own pages (`/w/{key}` and
 * `/r` opened directly) and, when the embed asks for it, in an iframe. `main.tsx` marks such a page at once, so the
 * first paint is already right.
 *
 * - With `dark` true on a page that follows the setting, a theme with `darkColors` shows that palette. Everything else
 *   shows `colors`, and a key left out falls to the built-in value, dark when `styles.css` says so.
 * - A theme with `colors` and no `darkColors` takes the page out of the mode, so the venue's palette is never mixed
 *   with the dark built-in one. A theme with `darkColors` keeps it.
 */
export function applyThemeToDocument(theme: unknown, doc: ThemeDocument, dark = false): void {
  const root = doc.documentElement;
  const palette = dark && root.dataset.scheme === "system" && setsDarkColors(theme) ? "dark" : "light";
  for (const name of Object.values(COLOR_VARS)) root.style.removeProperty(name);
  for (const [name, value] of themeVars(theme, palette)) root.style.setProperty(name, value);
  if (setsColors(theme) && !setsDarkColors(theme)) delete root.dataset.scheme;
}

let stopWatching: (() => void) | null = null;

/** Applies the theme, and applies it again when the visitor changes the system setting, if the theme has a dark palette. */
export function watchTheme(theme: unknown, win: { document: ThemeDocument; matchMedia?: Window["matchMedia"] }): void {
  stopWatching?.();
  stopWatching = null;
  const query = win.matchMedia?.("(prefers-color-scheme: dark)");
  applyThemeToDocument(theme, win.document, query?.matches ?? false);
  if (!query || !setsDarkColors(theme)) return;
  const again = (e: { matches: boolean }) => applyThemeToDocument(theme, win.document, e.matches);
  query.addEventListener("change", again);
  stopWatching = () => query.removeEventListener("change", again);
}

/** The logo address when it is an `https` URL with a host and no credentials, as the URL parser writes it. */
export function logoSrc(theme: unknown): string | null {
  if (!isObject(theme) || typeof theme.logoUrl !== "string") return null;
  const raw = theme.logoUrl;
  if (raw.length > MAX_LOGO_URL || /[\s\x00-\x1f\x7f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch {
    return null;
  }
}
