import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** A site path exists as a static file in public/ or as a Vite entry page at the root of the site package. */
export function siteFileExists(sitePath: string): boolean {
  const pathname = sitePath.split("#")[0];
  const file = (pathname.endsWith("/") ? `${pathname}index.html` : pathname).slice(1);
  return [resolve(process.cwd(), "public", file), resolve(process.cwd(), file)].some((f) => existsSync(f));
}
