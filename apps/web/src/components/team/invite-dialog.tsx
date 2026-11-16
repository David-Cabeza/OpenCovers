import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Role } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { inviteLink } from "@/lib/invite-link";

interface InviteValues {
  role: Role;
  email: string;
}

export function InviteDialog({
  venueId,
  open,
  onOpenChange,
}: {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<InviteValues>({ defaultValues: { role: "read", email: "" } });

  useEffect(() => {
    if (open) {
      reset({ role: "read", email: "" });
      setToken(null);
      setCopied(false);
      setLinkCopied(false);
    }
  }, [open, reset]);

  async function onSubmit(values: InviteValues) {
    const email = values.email.trim();
    try {
      const { invitation } = await api.createInvitation(venueId, {
        role: values.role,
        ...(email ? { email } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["invitations", venueId] });
      setToken(invitation.token);
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the invitation."));
    }
  }

  async function copy(text: string, what: string, done: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    done(true);
    toast.success(`${what} copied`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to this venue</DialogTitle>
          <DialogDescription>
            The invitee redeems the token once, within 72 hours.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy the link or the token now. Neither will be shown again. Send it over a private
              channel.
            </p>
            <div className="space-y-1">
              <Label>Invite link</Label>
              <div className="flex items-start gap-2">
                <code
                  data-testid="invite-link"
                  className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm"
                >
                  {inviteLink(token)}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy link"
                  onClick={() => copy(inviteLink(token), "Link", setLinkCopied)}
                >
                  {linkCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Token</Label>
              <div className="flex items-start gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm">
                  {token}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy token"
                  onClick={() => copy(token, "Token", setCopied)}
                >
                  {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                {...register("role")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-email">Email (optional)</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@example.com"
                {...register("email")}
              />
              <p className="text-sm text-muted-foreground">
                With an email only that address can redeem it. Without one, anyone holding the
                token can.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
