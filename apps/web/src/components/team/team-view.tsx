import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, UserCogIcon } from "lucide-react";
import { toast } from "sonner";
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
import { errorMessage } from "@/lib/error-message";
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
  const when = (iso: string) => new Date(iso).toLocaleString();
  if (i.status === "redeemed" && i.redeemedAt) return `Redeemed ${when(i.redeemedAt)}`;
  if (i.status === "revoked" && i.revokedAt) return `Revoked ${when(i.revokedAt)}`;
  return `${i.status === "pending" ? "Expires" : "Expired"} ${when(i.expiresAt)}`;
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
        title="Team"
        description="Who can use this venue, and what changed. Only admins see this page."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <PlusIcon className="size-4" /> Invite
          </Button>
        }
      />
      {members.data && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="People" value={list.length} />
          <Stat label="Admins" value={list.filter((m) => m.role === "admin").length} />
          <Stat
            label="Pending invites"
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
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
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
    onError: (err) => toast.error(errorMessage(err, "Could not remove the member.")),
    onSettled: () => setTarget(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>People with access to this venue.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : members.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <UserCogIcon className="size-4" /> No members.
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
                      aria-label={`Remove ${m.email}`}
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
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              {target?.email} will lose access to this venue on their next request. Their
              account and other venues are not affected. API keys they created in this venue
              are revoked, and webhooks they created are flagged for review.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => target && remove.mutate(target.userId)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InvitationsCard({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["invitations", venueId],
    queryFn: () => api.listInvitations(venueId),
  });
  const invitations = data?.invitations ?? [];

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(venueId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations", venueId] });
      toast.success("Invitation revoked");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not revoke the invitation.")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>
          OpenCovers sends no email, so you pass the token or link on yourself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : invitations.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">No invitations yet.</div>
        ) : (
          <ul className="-my-2 divide-y">
            {invitations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.email ?? "Open link"}</div>
                  <div className="text-sm text-muted-foreground">
                    {invitationDate(i)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{i.role}</Badge>
                  <Pill tone={STATUS_TONE[i.status]} dot>
                    {i.status}
                  </Pill>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
