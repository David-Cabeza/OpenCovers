import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthScreen } from "@/components/auth/auth-screen";
import { InviteJoin, InviteSignedOut } from "@/components/auth/invite-screen";
import { Dashboard } from "@/components/dashboard";
import { authClient } from "@/lib/auth-client";
import { takeInviteToken } from "@/lib/invite-link";

export default function App({ inviteToken = null }: { inviteToken?: string | null }) {
  const { data: session, isPending } = authClient.useSession();
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
