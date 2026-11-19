import { useEffect, useState } from "react";
import { CloudOffIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

const RETRY_MS = 10_000;

/** Shown in place of the sign-in screen when the session could not be read because the server did not answer. */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
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
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div role="alert" className="w-full max-w-sm space-y-6 text-center">
        <BrandMark className="mx-auto size-14 text-primary" />
        <div className="space-y-2">
          <CloudOffIcon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-display text-2xl">We can&apos;t reach the server</h1>
          <p className="text-sm text-muted-foreground">
            OpenCovers could not check your session, so we do not know whether you are signed in. Your data is
            not affected. Check your connection; we will try again every few seconds.
          </p>
        </div>
        <Button onClick={retry} disabled={trying} className="w-full">
          {trying ? "Trying…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}
