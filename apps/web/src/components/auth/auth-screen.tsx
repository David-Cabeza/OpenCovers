import { useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { useDemoStatus } from "@/lib/demo";
import { DemoSignIn } from "./demo-sign-in";
import { LanguageSelect } from "@/components/layout/language-select";
import { useT } from "@/i18n";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

type Tab = "sign-in" | "sign-up";

export function AuthScreen() {
  const t = useT();
  const demo = useDemoStatus();
  const [tab, setTab] = useState<Tab>("sign-in");
  return (
    <main className="relative flex min-h-dvh items-center justify-center p-6">
      <div className="absolute right-4 top-4">
        <LanguageSelect />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14 text-primary" />
          <div>
            <h1 className="font-display text-3xl">{"OpenCovers"}</h1>
            <p className="text-sm text-muted-foreground">
              {t("auth.tagline")}
            </p>
          </div>
        </div>

        {demo === null ? (
          <Loading><Skeleton className="h-72 w-full" /></Loading>
        ) : demo.enabled ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("demo.signIn.title")}</CardTitle>
              <CardDescription>{t("demo.signIn.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <DemoSignIn googleEnabled={demo.googleEnabled} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{tab === "sign-in" ? t("auth.signIn.title") : t("auth.signUp.title")}</CardTitle>
              <CardDescription>
                {tab === "sign-in" ? t("auth.signIn.description") : t("auth.signUp.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="sign-in">{t("auth.tab.signIn")}</TabsTrigger>
                  <TabsTrigger value="sign-up">{t("auth.tab.signUp")}</TabsTrigger>
                </TabsList>
                <TabsContent value="sign-in">
                  <SignInForm />
                </TabsContent>
                <TabsContent value="sign-up">
                  <SignUpForm />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
