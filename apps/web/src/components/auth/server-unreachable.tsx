import { useEffect, useState } from "react";
import { CloudOffIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

const RETRY_MS = 10_000;

/** Shown in place of the sign-in screen when the session could not be read because the server did not answer. */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const [trying, setTrying] = useState(false);

  function retry() {
    setTrying(true);
    onRetry();
    setTimeout(() => setTrying(false), 1500);
  }

  useEffect(() => {
    const timer = setInterval(onRetry, RETRY_MS);
    return () => clearInterval(timer);
  }, [onRetry]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div role="alert" className="w-full max-w-sm space-y-6 text-center">
        <BrandMark className="mx-auto size-14 text-primary" />
        <div className="space-y-2">
          <CloudOffIcon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-display text-2xl">{t("auth.unreachable.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.unreachable.description")}
          </p>
        </div>
        <Button onClick={retry} disabled={trying} className="w-full">
          {trying ? t("common.trying") : t("common.tryAgain")}
        </Button>
      </div>
    </main>
  );
}
