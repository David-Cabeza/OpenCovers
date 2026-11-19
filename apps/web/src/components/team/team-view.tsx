import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, UserCogIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { Pill, type PillTone } from "@/components/pill";
import { Stat } from "@/components/stat";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Invitation, type InvitationStatus, type Member } from "@/lib/api";
import { dateTime } from "@/lib/date";
import { errorMessage } from "@/lib/error-message";
import { t, useT } from "@/i18n";
import { AuditLog } from "./audit-log";
import { InviteDialog } from "./invite-dialog";
import { MakeCreatorButton, RoleSelect } from "./member-actions";
import { removalMessage } from "./removal-message";

const STATUS_TONE: Record<InvitationStatus, PillTone> = {
  pending: "info",
  redeemed: "success",
  revoked: "muted",
  expired: "warning",
};

function invitationDate(i: Invitation): string {
  if (i.status === "redeemed" && i.redeemedAt) return t("team.invitations.date.redeemed", { when: dateTime(i.redeemedAt) });
  if (i.status === "revoked" && i.revokedAt) return t("team.invitations.date.revoked", { when: dateTime(i.revokedAt) });
  return t(i.status === "pending" ? "team.invitations.date.expires" : "team.invitations.date.expired", {
    when: dateTime(i.expiresAt),
  });
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function TeamView({ venueId }: { venueId: string }) {
  const t = useT();
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = useQuery({
    queryKey: ["members", venueId],
    queryFn: () => api.listMembers(venueId),
  });
  const invitations = useQuery({
    queryKey: ["invitations", venueId],
    queryFn: () => api.listInvitations(venueId),
  });
  const list = members.data?.members ?? [];
  const pending = (invitations.data?.invitations ?? []).filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("team.title")}
        description={t("team.description")}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <PlusIcon className="size-4" /> {t("team.invite")}
          </Button>
        }
      />
      {members.data && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("team.stat.people")} value={list.length} />
          <Stat label={t("team.stat.admins")} value={list.filter((m) => m.role === "admin").length} />
          <Stat
            label={t("team.stat.pendingInvites")}
            value={pending.length}
            tone={pending.length > 0 ? "warning" : "default"}
          />
        </div>
      )}
      <MembersCard venueId={venueId} />
      <InvitationsCard venueId={venueId} />
      <AuditLog venueId={venueId} />
      <InviteDialog venueId={venueId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function MembersCard({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["members", venueId],
    queryFn: () => api.listMembers(venueId),
  });
  const [target, setTarget] = useState<Member | null>(null);
  const members = data?.members ?? [];

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(venueId, userId),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["members", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["audit", venueId] });
      toast.success(removalMessage(res.revoked));
    },
    onError: (err) => toast.error(errorMessage(err, t("team.members.removeFailed"))),
    onSettled: () => setTarget(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("team.members.title")}</CardTitle>
        <CardDescription>{t("team.members.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact title={t("team.members.loadError")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : members.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <UserCogIcon className="size-4" /> {t("team.members.empty")}
          </div>
        ) : (
          <ul className="-my-2 divide-y">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar size="lg">
                    <AvatarFallback className="bg-accent text-sm font-semibold text-accent-foreground">
                      {initials(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{m.email}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <RoleSelect venueId={venueId} member={m} />
                  <div className="flex gap-1">
                    <MakeCreatorButton member={m} />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("team.members.removeAria", { email: m.email })}
                      onClick={() => setTarget(m)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.remove.title")}</DialogTitle>
            <DialogDescription>
              {t("team.remove.description", { email: target?.email ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => target && remove.mutate(target.userId)}
            >
              {t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InvitationsCard({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["invitations", venueId],
    queryFn: () => api.listInvitations(venueId),
  });
  const invitations = data?.invitations ?? [];
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(venueId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations", venueId] });
      toast.success(t("team.invitations.revoked"));
    },
    onError: (err) => toast.error(errorMessage(err, t("team.invitations.revokeFailed"))),
    onSettled: () => setRevoking(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("team.invitations.title")}</CardTitle>
        <CardDescription>
          {t("team.invitations.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact title={t("team.invitations.loadError")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : invitations.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">{t("team.invitations.empty")}</div>
        ) : (
          <ul className="-my-2 divide-y">
            {invitations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.email ?? t("team.invitations.openLink")}</div>
                  <div className="text-sm text-muted-foreground">
                    {invitationDate(i)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t(`common.role.${i.role}`)}</Badge>
                  <Pill tone={STATUS_TONE[i.status]} dot>
                    {t(`team.invitations.status.${i.status}`)}
                  </Pill>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="sm" onClick={() => setRevoking(i)}>
                      {t("team.invitations.revoke")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        title={revoking?.email ? t("team.revoke.titleEmail", { email: revoking.email }) : t("team.revoke.titleOpen")}
        description={t("team.revoke.description")}
        confirmLabel={t("team.revoke.confirm")}
        keepLabel={t("team.revoke.keep")}
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onClose={() => setRevoking(null)}
      />
    </Card>
  );
}
