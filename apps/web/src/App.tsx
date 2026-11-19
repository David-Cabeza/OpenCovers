import { useEffect, useState } from "react";
import { ServerUnreachable } from "@/components/auth/server-unreachable";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthScreen } from "@/components/auth/auth-screen";
import { InviteJoin, InviteSignedOut } from "@/components/auth/invite-screen";
import { Dashboard } from "@/components/dashboard";
import { authClient } from "@/lib/auth-client";
import { takeInviteToken } from "@/lib/invite-link";

export default function App({ inviteToken = null }: { inviteToken?: string | null }) {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [token, setToken] = useState(inviteToken);

  useEffect(() => {
    const onHashChange = () => {
      const next = takeInviteToken();
      if (next) setToken(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  // Not signed in and the session could not be read: the server did not answer, which is not the same as signed out.
  if (!session && error) return <ServerUnreachable onRetry={() => void refetch()} />;

  if (token) {
    const done = () => setToken(null);
    return session ? (
      <InviteJoin token={token} onDone={done} />
    ) : (
      <InviteSignedOut token={token} onDone={done} />
    );
  }

  return session ? <Dashboard /> : <AuthScreen />;
}
