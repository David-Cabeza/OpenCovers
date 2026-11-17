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

/** The CSS custom properties a theme sets, each from a value that passed the rules. Absent or invalid keys are left out. */
export function themeVars(theme: unknown): [name: string, value: string][] {
  if (!isObject(theme)) return [];
  const vars: [string, string][] = [];
  if (isObject(theme.colors)) {
    for (const [key, value] of Object.entries(theme.colors)) {
      if (own(COLOR_VARS, key) && typeof value === "string" && HEX.test(value)) vars.push([COLOR_VARS[key], value.toLowerCase()]);
    }
  }
  const { radius, font } = theme;
  if (typeof radius === "number" && Number.isInteger(radius) && radius >= 0 && radius <= 24) vars.push(["--oc-radius", `${radius}px`]);
  if (typeof font === "string" && own(FONT_STACKS, font)) vars.push(["--oc-font", FONT_STACKS[font]]);
  return vars;
}

/** Sets the theme on an element's style, one property at a time, so no venue string is ever parsed as CSS. */
export function applyTheme(theme: unknown, style: Pick<CSSStyleDeclaration, "setProperty">): void {
  for (const [name, value] of themeVars(theme)) style.setProperty(name, value);
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
