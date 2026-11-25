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
import { Loading, Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type AuditAction, type Member } from "@/lib/api";
import { dateTime } from "@/lib/date";
import { errorMessage } from "@/lib/error-message";
import { useT, type MessageKey } from "@/i18n";

const ACTION_KEYS: Record<AuditAction, MessageKey> = {
  invited: "team.audit.action.invited",
  invite_revoked: "team.audit.action.invite_revoked",
  redeemed: "team.audit.action.redeemed",
  member_removed: "team.audit.action.member_removed",
  role_changed: "team.audit.action.role_changed",
  creator_transferred: "team.audit.action.creator_transferred",
  guest_blocked: "team.audit.action.guest_blocked",
  guest_unblocked: "team.audit.action.guest_unblocked",
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
  const t = useT();
  if (!id) return <span className="text-muted-foreground">{t("team.audit.none")}</span>;
  const member = members.get(id);
  if (member) return <>{member.name}</>;
  return (
    <span>
      <code className="text-xs">{shortId(id)}</code>{" "}
      <span className="text-xs text-muted-foreground">{t("team.audit.formerMember")}</span>
    </span>
  );
}

function Reference({ id }: { id: string | null }) {
  return id ? <code className="text-xs">{shortId(id)}</code> : null;
}

export function AuditLog({ venueId }: { venueId: string }) {
  const t = useT();
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
        <CardTitle>{t("team.audit.title")}</CardTitle>
        <CardDescription>
          {t("team.audit.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {audit.isPending ? (
          <Loading><Skeleton className="h-24 w-full" /></Loading>
        ) : audit.isError && entries.length === 0 ? (
          <div role="alert" className="flex items-center gap-3 py-2 text-sm text-destructive">
            {errorMessage(audit.error, t("team.audit.loadFailed"))}
            <Button variant="outline" size="sm" onClick={() => void audit.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">{t("team.audit.empty")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("team.audit.col.action")}</TableHead>
                <TableHead>{t("team.audit.col.by")}</TableHead>
                <TableHead>{t("team.audit.col.person")}</TableHead>
                <TableHead>{t("team.audit.col.role")}</TableHead>
                <TableHead>{t("team.audit.col.reference")}</TableHead>
                <TableHead>{t("team.audit.col.when")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Pill tone={ACTION_TONE[e.action] ?? "muted"} dot>
                      {ACTION_KEYS[e.action] ? t(ACTION_KEYS[e.action]) : e.action}
                    </Pill>
                  </TableCell>
                  <TableCell>
                    <Person id={e.actorUserId} members={members} />
                  </TableCell>
                  <TableCell>
                    <Person id={e.targetUserId} members={members} />
                  </TableCell>
                  <TableCell>
                    {e.role ? <Badge variant="secondary">{t(`common.role.${e.role}` as MessageKey)}</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <Reference id={e.invitationId ?? e.blocklistEntryId} />
                  </TableCell>
                  <TableCell>{dateTime(e.occurredAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {audit.isError && entries.length > 0 && (
          <div role="alert" className="text-sm text-destructive">
            {errorMessage(audit.error, t("team.audit.loadMoreFailed"))}
          </div>
        )}
        {audit.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            {t("team.audit.loadMore")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
