import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, UserCogIcon } from "lucide-react";
import { toast } from "sonner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type Member } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { InviteDialog } from "./invite-dialog";
import { MakeCreatorButton, RoleSelect } from "./member-actions";

export function TeamView({ venueId }: { venueId: string }) {
  return (
    <div className="space-y-8">
      <MembersCard venueId={venueId} />
      <InvitationsCard venueId={venueId} />
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["members", venueId] });
      toast.success("Member removed");
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>
                    <RoleSelect venueId={venueId} member={m} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              {target?.email} will lose access to this venue on their next request. Their
              account and other venues are not affected. API keys they created keep working
              until you revoke them.
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
  const [open, setOpen] = useState(false);
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
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Invite someone to this venue. OpenCovers sends no email, so you pass the token on.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <PlusIcon className="size-4" /> Invite
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : invitations.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">No invitations yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.email ?? "Open link"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{i.role}</Badge>
                  </TableCell>
                  <TableCell>{i.status}</TableCell>
                  <TableCell>{new Date(i.expiresAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {i.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke.mutate(i.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <InviteDialog venueId={venueId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
