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

const ROLES: Role[] = ["read", "write", "admin"];

export function RoleSelect({ venueId, member }: { venueId: string; member: Member }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (role: Role) => api.changeMemberRole(venueId, member.userId, role),
    onSuccess: () => toast.success("Role updated"),
    onError: (err) => toast.error(errorMessage(err, "Could not change the role.")),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["members", venueId] }),
  });

  return (
    <select
      aria-label={`Role of ${member.email}`}
      value={member.role}
      disabled={change.isPending}
      onChange={(e) => change.mutate(e.target.value as Role)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

export function MakeCreatorButton({ member }: { member: Member }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["account"], queryFn: () => api.getAccount() });
  const transfer = useMutation({
    mutationFn: () => api.transferCreator(member.userId),
    onSuccess: () => toast.success(`${member.email} can now create venues`),
    onError: (err) => toast.error(errorMessage(err, "Could not transfer venue creation.")),
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
        aria-label={`Make ${member.email} the venue creator`}
        title="Make venue creator"
        onClick={() => setOpen(true)}
      >
        <CrownIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make venue creator</DialogTitle>
            <DialogDescription>
              {member.email} will be the only account that can create venues on this
              instance, and you will lose that right. You keep access to your venues. Only
              they can hand it back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={transfer.isPending} onClick={() => transfer.mutate()}>
              Make creator
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
