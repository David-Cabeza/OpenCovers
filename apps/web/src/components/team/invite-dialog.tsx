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
import { useT, type MessageKey } from "@/i18n";

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
  const t = useT();
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
      toast.error(errorMessage(err, t("team.invite.failed")));
    }
  }

  async function copy(text: string, message: MessageKey, done: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    done(true);
    toast.success(t(message));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.invite.title")}</DialogTitle>
          <DialogDescription>
            {t("team.invite.description")}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("team.invite.shownOnce")}
            </p>
            <div className="space-y-1">
              <Label>{t("team.invite.linkLabel")}</Label>
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
                  aria-label={t("team.invite.copyLink")}
                  onClick={() => copy(inviteLink(token), "team.invite.linkCopied", setLinkCopied)}
                >
                  {linkCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("team.invite.tokenLabel")}</Label>
              <div className="flex items-start gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm">
                  {token}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("team.invite.copyToken")}
                  onClick={() => copy(token, "team.invite.tokenCopied", setCopied)}
                >
                  {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("team.invite.roleLabel")}</Label>
              <select
                id="invite-role"
                {...register("role")}
                className="flex h-9 coarse:h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="read">{t("team.invite.role.read")}</option>
                <option value="write">{t("team.invite.role.write")}</option>
                <option value="admin">{t("team.invite.role.admin")}</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("team.invite.emailLabel")}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@example.com" // i18n-ok
                {...register("email")}
              />
              <p className="text-sm text-muted-foreground">
                {t("team.invite.emailHint")}
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("team.invite.submitting") : t("team.invite.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
