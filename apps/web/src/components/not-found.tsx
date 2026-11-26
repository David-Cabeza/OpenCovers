import { useEffect } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

// There is no router: screens and links live in the query and the fragment. These are the only paths that load the app.
// `/oauth/consent` is where the API sends the consent step of remote MCP (ADR-0014).
const APP_PATHS = ["/", "/index.html", "/oauth/consent"];

export const isAppPath = (pathname: string) => APP_PATHS.includes(pathname.replace(/\/+$/, "") || "/");

export function NotFound() {
  const t = useT();

  useEffect(() => {
    document.title = `${t("layout.notFound.title")} · OpenCovers`;
    return () => {
      document.title = "OpenCovers";
    };
  }, [t]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <BrandMark className="mx-auto size-14 text-primary" />
        <div className="space-y-2">
          <h1 className="font-display text-2xl">{t("layout.notFound.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("layout.notFound.description")}</p>
        </div>
        <Button asChild className="w-full">
          <a href="/">{t("layout.notFound.action")}</a>
        </Button>
      </div>
    </main>
  );
}
