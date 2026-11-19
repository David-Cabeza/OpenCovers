import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CrownIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type Member, type Role } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useT } from "@/i18n";

const ROLES: Role[] = ["read", "write", "admin"];

export function RoleSelect({ venueId, member }: { venueId: string; member: Member }) {
  const t = useT();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (role: Role) => api.changeMemberRole(venueId, member.userId, role),
    onSuccess: () => toast.success(t("team.role.updated")),
    onError: (err) => toast.error(errorMessage(err, t("team.role.failed"))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["members", venueId] }),
  });

  return (
    <select
      aria-label={t("team.role.of", { email: member.email })}
      value={member.role}
      disabled={change.isPending}
      onChange={(e) => change.mutate(e.target.value as Role)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {t(`common.role.${r}`)}
        </option>
      ))}
    </select>
  );
}

export function MakeCreatorButton({ member }: { member: Member }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["account"], queryFn: () => api.getAccount() });
  const transfer = useMutation({
    mutationFn: () => api.transferCreator(member.userId),
    onSuccess: () => toast.success(t("team.creator.done", { email: member.email })),
    onError: (err) => toast.error(errorMessage(err, t("team.creator.failed"))),
    onSettled: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });

  const account = data?.account;
  if (!account?.isCreator || account.userId === member.userId) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("team.creator.aria", { email: member.email })}
        title={t("team.creator.title")}
        onClick={() => setOpen(true)}
      >
        <CrownIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.creator.title")}</DialogTitle>
            <DialogDescription>
              {t("team.creator.description", { email: member.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={transfer.isPending} onClick={() => transfer.mutate()}>
              {t("team.creator.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
