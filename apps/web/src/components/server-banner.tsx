import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { useServerStatus } from "@/stores/server-status";

const RETRY_MS = 15_000;

/** A bar across the top while the server cannot be reached. It asks again by itself, and on request. */
export function ServerBanner() {
  const t = useT();
  const down = useServerStatus((s) => s.down);
  const queryClient = useQueryClient();
  const [trying, setTrying] = useState(false);

  async function retry() {
    setTrying(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setTrying(false);
    }
  }

  useEffect(() => {
    if (!down) return;
    // A read still waiting for its answer is left to finish: restarting it every time would keep it from ever failing.
    const timer = setInterval(() => void queryClient.refetchQueries({ type: "active" }, { cancelRefetch: false }), RETRY_MS);
    return () => clearInterval(timer);
  }, [down, queryClient]);

  if (!down) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning print:hidden"
    >
      <span className="flex items-center gap-2">
        <CloudOffIcon className="size-4 shrink-0" aria-hidden="true" />
        {t("layout.serverBanner.message")}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={trying} onClick={() => void retry()}>
        {trying ? t("common.trying") : t("common.tryAgain")}
      </Button>
    </div>
  );
}
