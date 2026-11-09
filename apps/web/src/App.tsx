import { Skeleton } from "@/components/ui/skeleton";
import { AuthScreen } from "@/components/auth/auth-screen";
import { Dashboard } from "@/components/dashboard";
import { authClient } from "@/lib/auth-client";

export default function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  return session ? <Dashboard /> : <AuthScreen />;
}
