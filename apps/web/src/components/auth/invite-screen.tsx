import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrandMark } from "@/components/brand/brand-mark";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useT } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

function Shell({
  title,
  description,
  children,
}: {
  title?: string;
  description: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14 text-primary" />
          <h1 className="font-display text-3xl">OpenCovers</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title ?? t("auth.invite.title")}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

/**
 * The screen for an invitation link, signed in or not. It asks the server whether the link still works and says so
 * when it does not, instead of letting the person fill in a sign-up that is certain to be refused. The question never
 * holds the page up and a failed answer is not a reason to turn the link away: the normal screen shows meanwhile, and
 * the redemption itself remains the check that counts.
 */
export function InviteGate({
  token,
  signedIn,
  onDone,
}: {
  token: string;
  signedIn: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["invitation-check", token],
    queryFn: () => api.checkInvitation(token),
    retry: false,
    staleTime: Infinity,
  });
  if (data?.valid === false) {
    return (
      <Shell title={t("auth.invite.invalidTitle")} description={t("auth.invite.invalidDescription")}>
        <Button className="w-full" onClick={onDone}>
          {signedIn ? t("auth.invite.invalidContinueSignedIn") : t("auth.invite.invalidContinue")}
        </Button>
      </Shell>
    );
  }
  return signedIn ? <InviteJoin token={token} onDone={onDone} /> : <InviteSignedOut token={token} onDone={onDone} />;
}

/** A signed-out visitor with an invitation: sign up with the token, or sign in and join. */
export function InviteSignedOut({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  function signedUp() {
    void queryClient.invalidateQueries({ queryKey: ["venues"] });
    onDone();
  }
  return (
    <Shell description={t("auth.invite.signedOutDescription")}>
      <Tabs defaultValue="sign-up">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sign-up">{t("auth.tab.signUp")}</TabsTrigger>
          <TabsTrigger value="sign-in">{t("auth.invite.haveAccount")}</TabsTrigger>
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
  const t = useT();
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
      toast.success(t("auth.invite.joined"));
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("auth.invite.joinFailed")));
      setPending(false);
    }
  }

  return (
    <Shell description={t("auth.invite.joinDescription")}>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={join} disabled={pending}>
          {pending ? t("auth.invite.joining") : t("auth.invite.join")}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onDone} disabled={pending}>
          {t("auth.invite.notNow")}
        </Button>
      </div>
    </Shell>
  );
}
