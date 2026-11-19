import { errorMessage } from "@/lib/error-message";
import { useT } from "@/i18n";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pill, type PillTone } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadError } from "@/components/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenueKeys } from "@/hooks/use-venue-keys";
import { api, type ApiKey, type Role } from "@/lib/api";
import { CreateKeyDialog } from "./create-key-dialog";

const ROLE_TONE: Record<Role, PillTone> = { admin: "warning", write: "info", read: "muted" };
const ROLE_KEY = { admin: "common.role.admin", write: "common.role.write", read: "common.role.read" } as const;

export function ApiKeysCard({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useVenueKeys(venueId);
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const keys = data?.keys ?? [];

  const revoke = useMutation({
    mutationFn: (hash: string) => api.revokeVenueKey(venueId, hash),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["keys", venueId] });
      toast.success(t("setup.keys.revoked"));
    },
    onError: (err) => toast.error(errorMessage(err, t("setup.keys.revokeFailed"))),
    onSettled: () => setRevoking(null),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4">
        <div>
          <CardTitle>{t("setup.keys.title")}</CardTitle>
          <CardDescription>{t("setup.keys.description")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <PlusIcon className="size-4" /> {t("setup.keys.new")}
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact what={t("setup.keys.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : keys.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <KeyRoundIcon className="size-4" /> {t("setup.keys.empty")}
          </div>
        ) : (
          <ul className="-my-2 divide-y">
            {keys.map((k) => (
              <li key={k.hash} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
                  >
                    <KeyRoundIcon className="size-4" />
                  </span>
                  <span className="truncate font-medium">{k.principal}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={ROLE_TONE[k.role] ?? "muted"}>{ROLE_KEY[k.role] ? t(ROLE_KEY[k.role]) : k.role}</Pill>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("setup.keys.revokeLabel", { name: k.principal })}
                    onClick={() => setRevoking(k)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        title={revoking ? t("setup.keys.confirmTitle", { name: revoking.principal }) : t("setup.keys.confirmTitleFallback")}
        description={t("setup.keys.confirmDescription")}
        confirmLabel={t("setup.keys.confirmLabel")}
        keepLabel={t("setup.keys.keepLabel")}
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.hash)}
        onClose={() => setRevoking(null)}
      />
      <CreateKeyDialog venueId={venueId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
