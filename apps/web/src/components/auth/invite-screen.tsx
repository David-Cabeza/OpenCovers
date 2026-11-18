import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark } from "@/components/brand/brand-mark";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useUiStore } from "@/stores/ui-store";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

function Shell({
  description,
  children,
}: {
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14 text-primary" />
          <h1 className="font-display text-3xl">OpenCovers</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>You are invited</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A signed-out visitor with an invitation: sign up with the token, or sign in and join. */
export function InviteSignedOut({ token, onDone }: { token: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  function signedUp() {
    void queryClient.invalidateQueries({ queryKey: ["venues"] });
    onDone();
  }
  return (
    <Shell description="Create your account to join the venue.">
      <Tabs defaultValue="sign-up">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sign-up">Sign up</TabsTrigger>
          <TabsTrigger value="sign-in">I have an account</TabsTrigger>
        </TabsList>
        <TabsContent value="sign-up">
          <SignUpForm invitationToken={token} onSuccess={signedUp} />
        </TabsContent>
        <TabsContent value="sign-in">
          <SignInForm />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

/** A signed-in user with an invitation: one click redeems it. */
export function InviteJoin({ token, onDone }: { token: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const setVenue = useUiStore((s) => s.setVenue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    try {
      const { membership } = await api.redeemInvitation(token);
      await queryClient.invalidateQueries({ queryKey: ["venues"] });
      setVenue(membership.venueId);
      toast.success("You joined the venue.");
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Could not join the venue."));
      setPending(false);
    }
  }

  return (
    <Shell description="Join the venue with the account you are signed in with.">
      <div className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" onClick={join} disabled={pending}>
          {pending ? "Joining…" : "Join"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onDone} disabled={pending}>
          Not now
        </Button>
      </div>
    </Shell>
  );
}
