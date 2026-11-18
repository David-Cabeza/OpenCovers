import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Pill, type PillTone } from "@/components/pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type AuditAction, type Member } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";

const ACTION_LABELS: Record<AuditAction, string> = {
  invited: "Invitation created",
  invite_revoked: "Invitation revoked",
  redeemed: "Invitation redeemed",
  member_removed: "Member removed",
  role_changed: "Role changed",
  creator_transferred: "Venue creator transferred",
  guest_blocked: "Guest blocked",
  guest_unblocked: "Guest unblocked",
};

const ACTION_TONE: Record<AuditAction, PillTone> = {
  invited: "info",
  invite_revoked: "muted",
  redeemed: "success",
  member_removed: "danger",
  role_changed: "warning",
  creator_transferred: "warning",
  guest_blocked: "danger",
  guest_unblocked: "success",
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function Person({ id, members }: { id: string | null; members: Map<string, Member> }) {
  if (!id) return <span className="text-muted-foreground">None</span>;
  const member = members.get(id);
  if (member) return <>{member.name}</>;
  return (
    <span>
      <code className="text-xs">{shortId(id)}</code>{" "}
      <span className="text-xs text-muted-foreground">former member</span>
    </span>
  );
}

function Reference({ id }: { id: string | null }) {
  return id ? <code className="text-xs">{shortId(id)}</code> : null;
}

export function AuditLog({ venueId }: { venueId: string }) {
  const membersQuery = useQuery({
    queryKey: ["members", venueId],
    queryFn: () => api.listMembers(venueId),
  });
  const audit = useInfiniteQuery({
    queryKey: ["audit", venueId],
    queryFn: ({ pageParam }) => api.listAudit(venueId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const members = new Map((membersQuery.data?.members ?? []).map((m) => [m.userId, m]));
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Who invited, who joined, who was removed, role changes, creator transfers and blocklist changes, newest first. The log
          keeps ids only, so people who have left show as a shortened id.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {audit.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : audit.isError && entries.length === 0 ? (
          <div role="alert" className="flex items-center gap-3 py-2 text-sm text-destructive">
            {errorMessage(audit.error, "Could not load the audit log.")}
            <Button variant="outline" size="sm" onClick={() => void audit.refetch()}>
              Try again
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">No changes recorded yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Pill tone={ACTION_TONE[e.action] ?? "muted"} dot>
                      {ACTION_LABELS[e.action] ?? e.action}
                    </Pill>
                  </TableCell>
                  <TableCell>
                    <Person id={e.actorUserId} members={members} />
                  </TableCell>
                  <TableCell>
                    <Person id={e.targetUserId} members={members} />
                  </TableCell>
                  <TableCell>
                    {e.role ? <Badge variant="secondary">{e.role}</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <Reference id={e.invitationId ?? e.blocklistEntryId} />
                  </TableCell>
                  <TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {audit.isError && entries.length > 0 && (
          <div role="alert" className="text-sm text-destructive">
            {errorMessage(audit.error, "Could not load more entries.")}
          </div>
        )}
        {audit.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
